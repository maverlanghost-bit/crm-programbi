// api/create-customer.js
export default async function handler(req, res) {
    // 1. CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { nombre, email, telefono, tags, nota } = req.body;
        
        // --- DEBUG: Verificar variables de entorno ---
        let shopUrl = process.env.SHOPIFY_STORE_URL;
        const token = process.env.SHOPIFY_ADMIN_TOKEN;

        console.log("1. Iniciando proceso para:", email);
        
        if (!shopUrl || !token) {
            console.error("ERROR CRÍTICO: Faltan variables de entorno en Vercel.");
            return res.status(500).json({ error: 'Configuración del servidor incompleta' });
        }

        // Limpieza de URL agresiva (Shopify API requiere formato exacto)
        // Debe quedar como: tu-tienda.myshopify.com
        shopUrl = shopUrl.replace('https://', '').replace('http://', '').replace(/\/$/, '');
        
        // Si el usuario puso el dominio personalizado (ej: programbi.com), esto fallará.
        // Debe ser el dominio interno de Shopify.
        if (!shopUrl.includes('myshopify.com')) {
            console.warn("ADVERTENCIA: La URL no parece ser .myshopify.com. Esto suele causar errores 404.");
        }

        console.log(`2. Conectando a: https://${shopUrl}/admin/api/2024-01/customers/search.json`);

        // --- PASO A: BUSCAR ---
        const searchUrl = `https://${shopUrl}/admin/api/2024-01/customers/search.json?query=email:${email}`;
        const searchRes = await fetch(searchUrl, {
            headers: { 
                'X-Shopify-Access-Token': token,
                'Content-Type': 'application/json'
            }
        });

        if (!searchRes.ok) {
            const errorText = await searchRes.text();
            console.error("❌ ERROR SHOPIFY (BÚSQUEDA):", searchRes.status, errorText);
            throw new Error(`Error buscando cliente: ${errorText}`);
        }

        const searchData = await searchRes.json();
        console.log("3. Resultado búsqueda:", JSON.stringify(searchData));

        // --- PASO B: CREAR O ACTUALIZAR ---
        const firstName = nombre.split(' ')[0];
        const lastName = nombre.split(' ').slice(1).join(' ') || '.';
        
        let finalRes;
        let actionMsg = "";

        if (searchData.customers && searchData.customers.length > 0) {
            // Actualizar
            const customerId = searchData.customers[0].id;
            console.log("4. Cliente existe. ID:", customerId, "- Actualizando...");
            
            finalRes = await fetch(`https://${shopUrl}/admin/api/2024-01/customers/${customerId}.json`, {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer: {
                        id: customerId,
                        tags: searchData.customers[0].tags + ", " + tags,
                        note: searchData.customers[0].note + "\n" + nota
                    }
                })
            });
            actionMsg = "Actualizado";
        } else {
            // Crear
            console.log("4. Cliente NO existe. Creando nuevo...");
            
            // Payload de creación
            const newCustomerPayload = {
                customer: {
                    first_name: firstName,
                    last_name: lastName,
                    email: email,
                    // IMPORTANTE: Shopify falla si el teléfono tiene formato incorrecto.
                    // Si falla, intentamos enviarlo sin teléfono.
                    phone: telefono && telefono.length > 8 ? telefono : null,
                    tags: tags,
                    note: nota,
                    verified_email: true,
                    accepts_marketing: true
                }
            };

            finalRes = await fetch(`https://${shopUrl}/admin/api/2024-01/customers.json`, {
                method: 'POST',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify(newCustomerPayload)
            });
            actionMsg = "Creado";
        }

        const data = await finalRes.json();

        if (!finalRes.ok) {
            console.error("❌ ERROR SHOPIFY (CREAR/UPDATE):", JSON.stringify(data));
            // Devolvemos el error exacto de Shopify al frontend para verlo en consola
            return res.status(400).json({ error: 'Shopify rechazó los datos', details: data.errors });
        }

        console.log(`✅ ÉXITO: Cliente ${actionMsg}`);
        return res.status(200).json({ success: true, customer: data.customer });

    } catch (error) {
        console.error('SERVER ERROR:', error);
        return res.status(500).json({ error: error.message });
    }
}

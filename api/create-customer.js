// api/create-customer.js
export default async function handler(req, res) {
    // 1. Configuración de CORS (CRÍTICO: Sin credentials si usamos *)
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Manejar la petición "pre-flight" del navegador
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    try {
        const { nombre, email, telefono, tags, nota } = req.body;
        
        // Limpieza de URL de la tienda
        let shopUrl = process.env.SHOPIFY_STORE_URL;
        const token = process.env.SHOPIFY_ADMIN_TOKEN;

        if (shopUrl) shopUrl = shopUrl.replace('https://', '').replace(/\/$/, '');

        if (!shopUrl || !token) {
            console.error("Faltan credenciales SHOPIFY en Vercel");
            return res.status(500).json({ error: 'Error de configuración del servidor' });
        }

        console.log(`Procesando lead: ${email} para tienda: ${shopUrl}`);

        // 2. BUSCAR CLIENTE EN SHOPIFY
        const searchUrl = `https://${shopUrl}/admin/api/2024-01/customers/search.json?query=email:${email}`;
        const searchResponse = await fetch(searchUrl, {
            headers: { 
                'X-Shopify-Access-Token': token,
                'Content-Type': 'application/json'
            }
        });

        const searchData = await searchResponse.json();
        
        // Preparar datos
        const firstName = nombre.split(' ')[0];
        const lastName = nombre.split(' ').slice(1).join(' ') || '.';
        
        let response;
        
        // 3. LOGICA: CREAR O ACTUALIZAR
        if (searchData.customers && searchData.customers.length > 0) {
            // === ACTUALIZAR ===
            const existingId = searchData.customers[0].id;
            console.log(`Cliente existe (${existingId}). Actualizando...`);
            
            response = await fetch(`https://${shopUrl}/admin/api/2024-01/customers/${existingId}.json`, {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer: {
                        id: existingId,
                        tags: searchData.customers[0].tags + ", " + tags,
                        note: searchData.customers[0].note + "\n" + nota
                    }
                })
            });
        } else {
            // === CREAR ===
            console.log("Cliente nuevo. Creando...");
            response = await fetch(`https://${shopUrl}/admin/api/2024-01/customers.json`, {
                method: 'POST',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer: {
                        first_name: firstName,
                        last_name: lastName,
                        email: email,
                        phone: telefono, // Shopify validará formato estricto aquí
                        tags: tags,
                        note: nota,
                        verified_email: true,
                        accepts_marketing: true
                    }
                })
            });
        }

        const data = await response.json();

        // 4. MANEJO DE ERRORES DE SHOPIFY
        if (!response.ok) {
            console.error("Error devuelto por Shopify:", JSON.stringify(data));
            // Devolvemos el error detallado para verlo en la consola del navegador
            return res.status(400).json({ 
                error: 'Shopify rechazó la solicitud', 
                details: data.errors 
            });
        }

        return res.status(200).json({ success: true, customer: data.customer });

    } catch (error) {
        console.error('Error interno Vercel:', error);
        return res.status(500).json({ error: error.message });
    }
}

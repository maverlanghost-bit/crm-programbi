// api/create-customer.js
export default async function handler(req, res) {
    // 1. Configuración de CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // 2. Obtener credenciales y sanitizar URL
    const { nombre, email, telefono, tags, nota } = req.body;
    let shopUrl = process.env.SHOPIFY_STORE_URL;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    // Limpieza de seguridad por si pusiste https:// en la variable
    shopUrl = shopUrl.replace('https://', '').replace('/', '');

    if (!shopUrl || !token) {
        return res.status(500).json({ error: 'Faltan credenciales en Vercel' });
    }

    try {
        // 3. PASO A: Buscar si el cliente ya existe
        const searchUrl = `https://${shopUrl}/admin/api/2024-01/customers/search.json?query=email:${email}`;
        const searchResponse = await fetch(searchUrl, {
            headers: { 'X-Shopify-Access-Token': token }
        });
        const searchData = await searchResponse.json();

        // Preparar nombres
        const firstName = nombre.split(' ')[0];
        const lastName = nombre.split(' ').slice(1).join(' ') || '.';

        let response;
        let action = "";

        if (searchData.customers && searchData.customers.length > 0) {
            // === CLIENTE EXISTE: ACTUALIZAR ===
            const existingCustomer = searchData.customers[0];
            const newTags = existingCustomer.tags ? `${existingCustomer.tags}, ${tags}` : tags;
            
            // Nota: Agregamos la nueva nota a la anterior
            const newNote = existingCustomer.note ? `${existingCustomer.note}\n---\n${nota}` : nota;

            response = await fetch(`https://${shopUrl}/admin/api/2024-01/customers/${existingCustomer.id}.json`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': token
                },
                body: JSON.stringify({
                    customer: {
                        id: existingCustomer.id,
                        tags: newTags,
                        note: newNote,
                        accepts_marketing: true // Forzamos suscripción para que llegue el correo
                    }
                })
            });
            action = "updated";

        } else {
            // === CLIENTE NUEVO: CREAR ===
            response = await fetch(`https://${shopUrl}/admin/api/2024-01/customers.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': token
                },
                body: JSON.stringify({
                    customer: {
                        first_name: firstName,
                        last_name: lastName,
                        email: email,
                        phone: telefono,
                        tags: tags,
                        note: nota,
                        verified_email: true,
                        accepts_marketing: true
                    }
                })
            });
            action = "created";
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(JSON.stringify(data.errors));
        }

        return res.status(200).json({ success: true, customer: data.customer, action: action });

    } catch (error) {
        console.error('Shopify API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

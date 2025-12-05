// api/create-customer.js
export default async function handler(req, res) {
    // --- 1. CONFIGURACIÓN CORS (CRÍTICO) ---
    // Esto permite que Shopify se conecte sin bloqueos
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Manejo de la pre-verificación (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    // --- 2. LÓGICA PRINCIPAL ---
    try {
        const { nombre, email, telefono, tags, nota } = req.body;
        let shopUrl = process.env.SHOPIFY_STORE_URL;
        const token = process.env.SHOPIFY_ADMIN_TOKEN;

        // Limpieza básica de la URL
        if (shopUrl) shopUrl = shopUrl.replace('https://', '').replace(/\/$/, '');

        if (!shopUrl || !token) {
            return res.status(500).json({ error: 'Faltan credenciales del servidor' });
        }

        // A. BUSCAR CLIENTE
        const searchUrl = `https://${shopUrl}/admin/api/2024-01/customers/search.json?query=email:${email}`;
        const searchRes = await fetch(searchUrl, {
            headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
        });
        const searchData = await searchRes.json();

        // Preparar datos
        const firstName = nombre.split(' ')[0];
        const lastName = nombre.split(' ').slice(1).join(' ') || '.';
        let finalRes;

        // B. CREAR O ACTUALIZAR
        if (searchData.customers && searchData.customers.length > 0) {
            // Actualizar existente
            const customer = searchData.customers[0];
            const newTags = customer.tags ? `${customer.tags}, ${tags}` : tags;
            const newNote = customer.note ? `${customer.note}\n---\n${nota}` : nota;

            finalRes = await fetch(`https://${shopUrl}/admin/api/2024-01/customers/${customer.id}.json`, {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ customer: { id: customer.id, tags: newTags, note: newNote } })
            });
        } else {
            // Crear nuevo
            finalRes = await fetch(`https://${shopUrl}/admin/api/2024-01/customers.json`, {
                method: 'POST',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer: {
                        first_name: firstName, last_name: lastName, email, phone: telefono,
                        tags, note: nota, verified_email: true, accepts_marketing: true
                    }
                })
            });
        }

        const data = await finalRes.json();
        if (!finalRes.ok) throw new Error(JSON.stringify(data.errors));

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

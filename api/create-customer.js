// api/create-customer.js
// Este código corre en los servidores de Vercel, no en el navegador.

export default async function handler(req, res) {
    // 1. Configuración de CORS (Para permitir que tu web Shopify hable con Vercel)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // O pon aquí tu dominio 'https://tutienda.com'
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2. Credenciales (Configúralas en Vercel > Settings > Environment Variables)
    const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL; // ej: "mitienda.myshopify.com"
    const ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // Token shpat_...

    if (!SHOPIFY_STORE || !ACCESS_TOKEN) {
        return res.status(500).json({ error: 'Server misconfiguration' });
    }

    try {
        const { nombre, email, telefono, tags, nota } = req.body;

        // Separar Nombre y Apellido (básico)
        const nameParts = (nombre || '').split(' ');
        const firstName = nameParts[0] || 'Cliente';
        const lastName = nameParts.slice(1).join(' ') || '';

        // 3. Llamada a la API de Shopify (Admin)
        const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/customers.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': ACCESS_TOKEN
            },
            body: JSON.stringify({
                customer: {
                    first_name: firstName,
                    last_name: lastName,
                    email: email,
                    phone: telefono,
                    verified_email: true,
                    tags: tags, // Ej: "newsletter, curso-python"
                    note: nota,
                    accepts_marketing: true, // ¡CRUCIAL PARA AUTOMATIZACIONES!
                    accepts_marketing_updated_at: new Date().toISOString()
                }
            })
        });

        const data = await response.json();

        // Si el cliente ya existe (error 422), intentamos actualizarlo o simplemente retornamos éxito
        if (!response.ok) {
            if (data.errors && JSON.stringify(data.errors).includes('taken')) {
                // El cliente ya existe, retornamos éxito para no asustar al usuario
                return res.status(200).json({ message: 'Customer already exists', success: true });
            }
            throw new Error(JSON.stringify(data.errors));
        }

        return res.status(200).json({ success: true, customer: data.customer });

    } catch (error) {
        console.error('Shopify API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

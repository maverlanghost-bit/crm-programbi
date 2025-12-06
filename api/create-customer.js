// api/create-customer.js
export default async function handler(req, res) {
    // 1. Configuración de CORS
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    try {
        const { nombre, email, telefono, tags, nota } = req.body;
        
        // 2. OBTENER CREDENCIALES
        // Limpiamos la URL por si pusiste "https://" o barras al final
        let shopUrl = process.env.SHOPIFY_STORE_URL;
        if (shopUrl) shopUrl = shopUrl.replace('https://', '').replace(/\/$/, '');
        
        const token = process.env.SHOPIFY_ADMIN_TOKEN;

        // --- DIAGNÓSTICO DE CLAVE (NUEVO) ---
        // Esto mostrará en los logs de Vercel si la variable existe y cómo empieza
        const tokenPreview = token ? `${token.substring(0, 6)}...${token.substring(token.length - 4)}` : "NO_DEFINIDO";
        console.log(`🔍 Diagnóstico: Tienda=[${shopUrl}] | Token=[${tokenPreview}]`);

        if (!shopUrl || !token) {
            console.error("❌ Faltan variables de entorno en Vercel");
            return res.status(500).json({ error: 'Faltan credenciales (SHOPIFY_STORE_URL o SHOPIFY_ADMIN_TOKEN) en Vercel.' });
        }

        // --- PRUEBA DE FUEGO (NUEVO) ---
        // Intentamos una conexión simple para verificar la clave ANTES de procesar
        const testUrl = `https://${shopUrl}/admin/api/2024-01/shop.json`;
        const testResponse = await fetch(testUrl, {
            headers: { 'X-Shopify-Access-Token': token }
        });

        if (testResponse.status === 401) {
            console.error("❌ Shopify rechazó el token (401 Unauthorized)");
            return res.status(401).json({ 
                error: 'CLAVE INVÁLIDA: Shopify rechazó el acceso. Verifica que uses el "Admin API Access Token" (empieza con shpat_...) y no la "API Key".' 
            });
        }
        
        if (!testResponse.ok) {
            console.error(`❌ Error de conexión con tienda: ${testResponse.status}`);
            return res.status(502).json({ error: `No pude conectar con la tienda ${shopUrl}. ¿La URL es correcta?` });
        }

        // 3. PROCESO NORMAL (Si pasamos la prueba de fuego)
        console.log(`✅ Credenciales OK. Procesando lead: ${email}`);

        // A) BUSCAR CLIENTE
        const searchUrl = `https://${shopUrl}/admin/api/2024-01/customers/search.json?query=email:${email}`;
        const searchResponse = await fetch(searchUrl, {
            headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
        });
        const searchData = await searchResponse.json();
        
        const firstName = nombre.split(' ')[0];
        const lastName = nombre.split(' ').slice(1).join(' ') || '.';
        let response;
        
        // B) CREAR O ACTUALIZAR
        if (searchData.customers && searchData.customers.length > 0) {
            const existingId = searchData.customers[0].id;
            console.log(`🔄 Actualizando cliente existente: ${existingId}`);
            response = await fetch(`https://${shopUrl}/admin/api/2024-01/customers/${existingId}.json`, {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer: {
                        id: existingId,
                        tags: searchData.customers[0].tags + ", " + tags,
                        note: (searchData.customers[0].note || '') + "\n" + nota
                    }
                })
            });
        } else {
            console.log("✨ Creando cliente nuevo...");
            response = await fetch(`https://${shopUrl}/admin/api/2024-01/customers.json`, {
                method: 'POST',
                headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
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
        }

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ Shopify Error:", JSON.stringify(data));
            // Devolvemos el error detallado de Shopify (ej: "Email has already been taken" si falló la búsqueda)
            return res.status(400).json({ error: 'Rechazo de Shopify', details: data.errors });
        }

        return res.status(200).json({ success: true, customer: data.customer });

    } catch (error) {
        console.error('❌ Error Crítico Vercel:', error);
        return res.status(500).json({ error: error.message });
    }
}

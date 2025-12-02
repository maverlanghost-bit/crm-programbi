// firebase-config.js

// 1. Importamos las librerías desde los servidores de Google (CDN)
// Esto permite que funcione en Shopify y en cualquier navegador sin instalar nada extra.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// 2. Tu configuración específica (La que me pasaste)
const firebaseConfig = {
  apiKey: "AIzaSyDVlTFLAX1Ya28uoqQ-mqTFFakHxQ3GgVI",
  authDomain: "crm-programbi-9934a.firebaseapp.com",
  projectId: "crm-programbi-9934a",
  storageBucket: "crm-programbi-9934a.firebasestorage.app",
  messagingSenderId: "646856396244",
  appId: "1:646856396244:web:6caacd7c27b644f087da41"
};

// 3. Inicializamos la aplicación
const app = initializeApp(firebaseConfig);

// 4. Inicializamos los servicios
const db = getFirestore(app); // Base de datos
const auth = getAuth(app);    // Sistema de login (para el admin)

console.log("✅ Firebase (CRM Capacitaciones) conectado correctamente");

// 5. Exportamos las herramientas para usarlas en otros archivos
export { db, auth };
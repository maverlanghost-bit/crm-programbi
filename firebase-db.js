// ==========================================
// MÓDULO DE BASE DE DATOS (FIREBASE LAYER)
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword,
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query, 
    orderBy, 
    onSnapshot, 
    doc, 
    updateDoc, 
    deleteDoc,
    addDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 1. CONFIGURACIÓN
const firebaseConfig = {
    apiKey: "AIzaSyDVlTFLAX1Ya28uoqQ-mqTFFakHxQ3GgVI",
    authDomain: "crm-programbi-9934a.firebaseapp.com",
    projectId: "crm-programbi-9934a",
    storageBucket: "crm-programbi-9934a.firebasestorage.app",
    messagingSenderId: "646856396244",
    appId: "1:646856396244:web:6caacd7c27b644f087da41"
};

// Inicialización Singleton
let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("🔥 Firebase conectado correctamente");
} catch (e) {
    console.error("Error crítico conectando Firebase:", e);
}

// ==========================================
// SERVICIOS DE AUTENTICACIÓN
// ==========================================

export const authService = {
    onStateChange: (callback) => onAuthStateChanged(auth, callback),
    
    login: async (email, password) => {
        try {
            await signInWithEmailAndPassword(auth, email, password);
            return { success: true };
        } catch (error) {
            console.error("Error login:", error);
            return { success: false, error: error.message };
        }
    },
    
    logout: () => signOut(auth)
};

// ==========================================
// GESTIÓN DE LEADS
// ==========================================

export const leadsService = {
    subscribe: (callback) => {
        const q = query(collection(db, "leads"), orderBy("fecha", "desc"));
        return onSnapshot(q, (snapshot) => {
            const leads = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                leads.push({
                    id: docSnap.id,
                    ...data,
                    telefono: data.telefono || '',
                    mensaje: data.mensaje || '',
                    // Normalización robusta del curso de interés
                    curso_interes: Array.isArray(data.intereses) 
                        ? data.intereses[0] 
                        : (data.intereses || 'General')
                });
            });
            callback(leads);
        }, (error) => console.error("Error obteniendo leads:", error));
    },

    update: async (id, data) => {
        await updateDoc(doc(db, "leads", id), data);
    },

    moveToTrash: async (id) => {
        await updateDoc(doc(db, "leads", id), { status: 'trashed' });
    },

    deletePermanent: async (id) => {
        await deleteDoc(doc(db, "leads", id));
    }
};

// ==========================================
// GESTIÓN DE PLANTILLAS (VALIDACIÓN ESTRICTA)
// ==========================================

export const templatesService = {
    subscribe: (callback) => {
        const q = query(collection(db, "email_templates"), orderBy("courseName", "asc"));
        
        return onSnapshot(q, (snapshot) => {
            const templates = [];
            snapshot.forEach(doc => {
                templates.push({ id: doc.id, ...doc.data() });
            });
            callback(templates);
        }, (error) => {
            console.error("Error suscribiendo a plantillas:", error);
        });
    },

    save: async (id, templateData) => {
        // 1. VALIDACIÓN DE DATOS (Guard Clause)
        if (!templateData.courseName) throw new Error("El nombre del curso (Trigger) es obligatorio");
        if (!templateData.subject) throw new Error("El asunto del correo es obligatorio");

        // 2. LIMPIEZA DE DATOS
        const cleanData = {
            courseName: templateData.courseName.trim(), 
            subject: templateData.subject.trim(),
            body: templateData.body || '',
            pdfLink: templateData.pdfLink || '',
            autoSend: !!templateData.autoSend, // Asegurar booleano
            updatedAt: serverTimestamp()
        };

        // 3. OPERACIÓN ATÓMICA
        try {
            if (id) {
                await updateDoc(doc(db, "email_templates", id), cleanData);
                console.log("✅ Plantilla actualizada:", id);
            } else {
                const docRef = await addDoc(collection(db, "email_templates"), cleanData);
                console.log("✅ Nueva plantilla creada:", docRef.id);
            }
            return true;
        } catch (error) {
            console.error("❌ Error guardando plantilla en DB:", error);
            throw error; // Re-lanzar para que la UI pueda mostrar la alerta
        }
    },

    delete: async (id) => {
        try {
            await deleteDoc(doc(db, "email_templates", id));
            console.log("🗑️ Plantilla eliminada:", id);
        } catch (error) {
            console.error("❌ Error eliminando plantilla:", error);
            throw error;
        }
    }
};
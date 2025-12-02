// admin-logic.js
import { auth, db } from "./firebase-config.js";
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    collection, 
    query, 
    orderBy, 
    onSnapshot, 
    doc, 
    updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- REFERENCIAS DOM ---
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const tableBody = document.getElementById('leads-table-body');
const logoutBtn = document.getElementById('logout-btn');
const exportBtn = document.getElementById('export-btn');

// Variables de Estado
let allLeadsData = []; // Aquí guardaremos copia de los datos para exportar

// --- 1. SISTEMA DE AUTENTICACIÓN ---

// Escuchar cambios de sesión (Login/Logout)
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Usuario logueado: Mostrar Dashboard
        loginView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        document.getElementById('user-display').textContent = user.email;
        cargarLeadsEnTiempoReal();
    } else {
        // Usuario no logueado: Mostrar Login
        dashboardView.classList.add('hidden');
        loginView.classList.remove('hidden');
    }
});

// Manejar Submit del Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = loginForm.querySelector('button');

    try {
        loginError.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = "Verificando...";
        await signInWithEmailAndPassword(auth, email, password);
        // El onAuthStateChanged se encargará del resto
    } catch (error) {
        console.error(error);
        loginError.textContent = "Credenciales incorrectas. Intenta de nuevo.";
        loginError.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = "Ingresar al CRM";
    }
});

// Manejar Logout
logoutBtn.addEventListener('click', () => signOut(auth));

// --- 2. LÓGICA DEL DASHBOARD (LEADS) ---

function cargarLeadsEnTiempoReal() {
    // Consulta: Colección 'leads' ordenada por fecha (más nuevo arriba)
    const q = query(collection(db, "leads"), orderBy("fecha_creacion", "desc"));

    // Listener en tiempo real (se ejecuta cada vez que algo cambia en la BD)
    onSnapshot(q, (snapshot) => {
        allLeadsData = []; // Reiniciar cache local
        tableBody.innerHTML = ''; // Limpiar tabla

        let countTotal = 0;
        let countPending = 0;
        let countContacted = 0;

        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-500">Aún no hay registros.</td></tr>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;
            
            // Guardar para exportar luego
            allLeadsData.push({ id, ...data });

            // Contadores
            countTotal++;
            if (data.status === 'contactado') countContacted++;
            else countPending++;

            // Renderizar Fila
            const row = document.createElement('tr');
            row.className = "hover:bg-gray-50 border-b border-gray-100 fade-in transition";
            
            // Lógica B2B (Empresas)
            const isCorporate = esCorreoEmpresa(data.email);
            const corporateIcon = isCorporate 
                ? `<span class="ml-2 text-blue-600" title="Posible Empresa"><i class="fa-solid fa-briefcase"></i></span>` 
                : '';

            row.innerHTML = `
                <td class="p-4 text-gray-500 whitespace-nowrap text-xs">
                    ${formatearFecha(data.fecha_creacion)}
                </td>
                <td class="p-4">
                    <div class="font-bold text-gray-800">${data.nombre}</div>
                    <div class="text-sm text-gray-500 flex items-center">
                        ${data.email} ${corporateIcon}
                    </div>
                </td>
                <td class="p-4">
                    <div class="text-sm text-gray-700 font-mono">${data.telefono}</div>
                </td>
                <td class="p-4">
                    <span class="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-semibold border border-blue-100">
                        ${data.curso_interes || 'General'}
                    </span>
                    ${data.mensaje ? `<div class="text-xs text-gray-400 mt-1 italic truncate max-w-[150px]" title="${data.mensaje}">"${data.mensaje}"</div>` : ''}
                </td>
                <td class="p-4">
                    ${getStatusBadge(data.status)}
                </td>
                <td class="p-4 text-center space-x-2">
                    <!-- Botón WhatsApp -->
                    <a href="${generarLinkWhatsapp(data.telefono)}" target="_blank" 
                       class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-600 hover:bg-green-200 transition" title="Abrir WhatsApp">
                        <i class="fab fa-whatsapp"></i>
                    </a>
                    
                    <!-- Botón Llamar -->
                    <a href="tel:${data.telefono}" 
                       class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition" title="Llamar">
                        <i class="fa-solid fa-phone"></i>
                    </a>

                    <!-- Botón Cambiar Estado -->
                    <button onclick="window.toggleStatus('${id}', '${data.status}')" 
                            class="inline-flex items-center justify-center w-8 h-8 rounded-full ${data.status === 'contactado' ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'} transition" 
                            title="${data.status === 'contactado' ? 'Marcar como Pendiente' : 'Marcar como Contactado'}">
                        <i class="fa-solid ${data.status === 'contactado' ? 'fa-undo' : 'fa-check'}"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Actualizar Tarjetas de Estadísticas
        document.getElementById('stat-total').textContent = countTotal;
        document.getElementById('stat-pending').textContent = countPending;
        document.getElementById('stat-contacted').textContent = countContacted;
    });
}

// --- 3. FUNCIONES AUXILIARES Y UTILIDADES ---

// Función global para cambiar estado (accesible desde el HTML)
window.toggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'contactado' ? 'pendiente' : 'contactado';
    try {
        const leadRef = doc(db, "leads", id);
        await updateDoc(leadRef, { 
            status: newStatus,
            last_action: new Date()
        });
        // No necesitamos actualizar la UI manualmente, el onSnapshot lo hará solo
    } catch (error) {
        console.error("Error actualizando estado:", error);
        alert("Error al actualizar. Verifica tu conexión.");
    }
};

function formatearFecha(timestamp) {
    if (!timestamp) return '--';
    const date = timestamp.toDate();
    return date.toLocaleDateString('es-CL', { 
        day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit' 
    });
}

function getStatusBadge(status) {
    if (status === 'contactado') {
        return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <span class="w-2 h-2 mr-1 bg-green-400 rounded-full"></span> Contactado
                </span>`;
    } else {
        return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    <span class="w-2 h-2 mr-1 bg-yellow-400 rounded-full animate-pulse"></span> Pendiente
                </span>`;
    }
}

function esCorreoEmpresa(email) {
    const dominiosGratis = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com'];
    const dominio = email.split('@')[1];
    return !dominiosGratis.includes(dominio);
}

function generarLinkWhatsapp(telefono) {
    if (!telefono) return '#';
    // Limpiar número: dejar solo dígitos
    let limpio = telefono.replace(/\D/g, ''); 
    // Si no tiene código de país (ej. empieza con 9), agregar 56
    if (limpio.length === 9) limpio = '56' + limpio;
    return `https://wa.me/${limpio}`;
}

// --- 4. EXPORTAR A EXCEL (CSV) ---
exportBtn.addEventListener('click', () => {
    if (allLeadsData.length === 0) {
        alert("No hay datos para exportar.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    // Encabezados
    csvContent += "Fecha,Nombre,Email,Telefono,Curso,Mensaje,Estado,Es Empresa\n";

    allLeadsData.forEach(row => {
        // Preparar datos para evitar errores con comas en el mensaje
        const fecha = row.fecha_creacion ? row.fecha_creacion.toDate().toLocaleDateString() : '';
        const mensajeLimpio = row.mensaje ? row.mensaje.replace(/,/g, ' ') : '';
        const esEmpresa = esCorreoEmpresa(row.email) ? "SI" : "NO";

        const fila = `${fecha},${row.nombre},${row.email},${row.telefono},${row.curso_interes},${mensajeLimpio},${row.status},${esEmpresa}`;
        csvContent += fila + "\n";
    });

    // Crear link de descarga invisible y activarlo
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `crm_leads_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});
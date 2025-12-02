import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURACIÓN FIREBASE (REEMPLAZA CON TUS DATOS SI ES NECESARIO) ---
const firebaseConfig = {
    apiKey: "AIzaSyDVlTFLAX1Ya28uoqQ-mqTFFakHxQ3GgVI",
    authDomain: "crm-programbi-9934a.firebaseapp.com",
    projectId: "crm-programbi-9934a",
    storageBucket: "crm-programbi-9934a.firebasestorage.app",
    messagingSenderId: "646856396244",
    appId: "1:646856396244:web:6caacd7c27b644f087da41"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ESTADO GLOBAL ---
let allLeads = [];
let isTrashMode = false;
let currentView = 'table';
let chartInstance = null;
let showChart = localStorage.getItem('crm_show_chart') === 'true'; // Recordar preferencia

// Configuración de columnas con tipos (v4)
// Ejemplo estructura: { name: "Dirección", type: "text" }, { name: "Pago", type: "select", options: ["Si","No"] }
let customColumns = JSON.parse(localStorage.getItem('crm_custom_cols_v2') || '[]');

let templates = JSON.parse(localStorage.getItem('crm_templates')) || {
    whatsapp: [
        { title: '👋 Saludo Inicial', text: 'Hola {nombre}, gracias por interesarte en {curso}. ¿Cómo puedo ayudarte hoy?' },
        { title: '📄 Enviar Temario', text: 'Hola {nombre}, aquí tienes el temario completo de {curso} que solicitaste.' }
    ],
    email: [ 
        { title: 'Bienvenida', subject: 'Info {curso}', text: 'Hola {nombre},\n\nGracias por contactar a ProgramBI...' } 
    ]
};

// --- INICIO & AUTH ---
onAuthStateChanged(auth, user => {
    const login = document.getElementById('login-view');
    const dash = document.getElementById('dashboard-view');
    
    if(user) {
        login.classList.add('hidden');
        dash.classList.remove('hidden');
        document.getElementById('user-display').textContent = user.email.split('@')[0];
        toggleChartVisibility(true); // Aplicar preferencia guardada
        initDataListener();
    } else {
        dash.classList.add('hidden');
        login.classList.remove('hidden');
    }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const originalText = btn.innerText;
    btn.innerText = "Verificando...";
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
    } catch(err) {
        Swal.fire('Error', 'Credenciales incorrectas', 'error');
        btn.innerText = originalText;
    }
});

document.getElementById('logout-btn').onclick = () => signOut(auth);

// --- VISUALIZACIÓN DEL GRÁFICO ---
window.toggleChartVisibility = (forceInit = false) => {
    if(!forceInit) {
        showChart = !showChart;
        localStorage.setItem('crm_show_chart', showChart);
    }
    const container = document.getElementById('chart-container');
    const btnIcon = document.getElementById('btn-toggle-chart').querySelector('i');
    
    if(showChart) {
        container.classList.remove('hidden');
        btnIcon.className = "fa-solid fa-chart-area text-blue-600";
        if(allLeads.length > 0) updateChart(); // Redibujar si hay datos
    } else {
        container.classList.add('hidden');
        btnIcon.className = "fa-solid fa-chart-line text-slate-400";
    }
};

// --- DATA LISTENER ---
function initDataListener() {
    const q = query(collection(db, "leads"), orderBy("fecha_creacion", "desc"));
    onSnapshot(q, (snapshot) => {
        allLeads = [];
        const notifs = [];
        const courseSet = new Set();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const lead = { id: docSnap.id, ...data };
            allLeads.push(lead);

            // Filtro Cursos
            if(lead.curso_interes) {
                const name = lead.curso_interes.split(' ')[0] + (lead.curso_interes.includes('BI') ? ' BI' : '');
                courseSet.add(name.trim());
            }

            // Notificaciones (Pendientes < 5 días)
            if(lead.fecha_creacion) {
                const days = (new Date() - lead.fecha_creacion.toDate())/(1000*3600*24);
                if(days < 5 && lead.status === 'pendiente') notifs.push(lead);
            }
        });

        updateKPIs();
        updateNotifications(notifs);
        updateCourseFilter(courseSet);
        if(showChart) updateChart();
        renderApp();
    });
}

function updateChart() {
    if(!showChart) return;
    const ctx = document.getElementById('trendChart').getContext('2d');
    const days = Array(7).fill(0);
    const labels = [];
    
    for(let i=6; i>=0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('es-CL', {weekday:'short'}));
    }

    allLeads.forEach(l => {
        if(l.fecha_creacion) {
            const diff = Math.floor((new Date() - l.fecha_creacion.toDate())/(1000*60*60*24));
            if(diff < 7) days[6-diff]++;
        }
    });

    if(chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Leads Últimos 7 días',
                data: days,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: {display: false} } }
    });
}

// --- RENDERIZADO PRINCIPAL ---
window.renderApp = () => {
    const txt = document.getElementById('search-input').value.toLowerCase();
    const dateFilter = document.getElementById('filter-date').value;
    const courseFilter = document.getElementById('filter-course').value;

    const filtered = allLeads.filter(l => {
        if(isTrashMode && l.status !== 'trashed') return false;
        if(!isTrashMode && l.status === 'trashed') return false;

        const matchTxt = (l.nombre||'').toLowerCase().includes(txt) || (l.email||'').toLowerCase().includes(txt);
        let matchDate = true;
        
        if(dateFilter !== 'all' && l.fecha_creacion) {
            const d = l.fecha_creacion.toDate();
            const now = new Date();
            if(dateFilter === 'today') matchDate = d.toDateString() === now.toDateString();
            if(dateFilter === 'week') matchDate = (now - d) < 604800000;
        }

        let matchCourse = courseFilter === 'all' ? true : (l.curso_interes||'').includes(courseFilter);

        return matchTxt && matchDate && matchCourse;
    });

    if(currentView === 'table') renderTable(filtered);
    else renderKanban(filtered);
};

// --- RENDER TABLA ---
function renderTable(list) {
    const thead = document.getElementById('table-header-row');
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    // 1. Headers Dinámicos
    let headers = `
        <th class="p-4">Prioridad</th>
        <th class="p-4">Cliente</th>
        <th class="p-4">Interés</th>
        <th class="p-4">Mensaje</th>
        <th class="p-4">Notas</th>
        <th class="p-4">Llamada</th>
        <th class="p-4">Compras</th>
        <th class="p-4 text-center">Estado</th>
    `;
    
    customColumns.forEach((col, idx) => {
        let icon = 'fa-font';
        if(col.type === 'date') icon = 'fa-calendar';
        if(col.type === 'select') icon = 'fa-list';
        
        headers += `
            <th class="p-4 group cursor-pointer" onclick="window.removeColumn(${idx})">
                <div class="flex items-center gap-1 text-blue-600">
                    <i class="fa-solid ${icon} text-xs opacity-50"></i> 
                    ${col.name}
                    <i class="fa-solid fa-xmark text-xs opacity-0 group-hover:opacity-100 text-red-400 ml-1"></i>
                </div>
            </th>`;
    });
    
    headers += `<th class="p-4 text-center">Acciones</th>`;
    thead.innerHTML = headers;

    if(!list.length) { tbody.innerHTML = '<tr><td colspan="100" class="p-8 text-center text-slate-400">No hay datos coincidentes</td></tr>'; return; }

    list.forEach(l => {
        const isCorp = isCorporate(l.email);
        const rowClass = isCorp ? 'is-corp bg-blue-50/50' : '';
        const corpBadge = isCorp ? '<i class="fa-solid fa-building text-blue-500 ml-1" title="Empresa"></i>' : '';
        
        // Tags Cursos
        const courses = (l.curso_interes||'').split(',').map(c => {
            let cls = 'bg-slate-100 border-slate-200 text-slate-600';
            if(c.includes('Power')) cls = 'tag-pbi';
            if(c.includes('SQL')) cls = 'tag-sql';
            if(c.includes('Python')) cls = 'tag-py';
            if(c.includes('Excel')) cls = 'tag-xls';
            return `<span class="text-[10px] px-2 py-0.5 rounded-full border mr-1 ${cls}">${c.trim()}</span>`;
        }).join('');

        // Celdas Custom
        let customCells = '';
        customColumns.forEach(col => {
            const val = (l.custom_fields && l.custom_fields[col.name]) || '';
            let displayVal = val || '<span class="text-slate-300 italic text-xs">Vacío</span>';
            
            // Si es fecha, formatear bonito
            if(col.type === 'date' && val) displayVal = new Date(val).toLocaleDateString();

            customCells += `
                <td class="p-4 border-l border-slate-100 dark:border-slate-700/50">
                    <div class="cursor-pointer hover:bg-white/50 p-1 rounded transition" onclick="window.editCustomField('${l.id}', '${col.name}', '${col.type}', '${val}')">
                        ${displayVal}
                    </div>
                </td>
            `;
        });

        const tr = document.createElement('tr');
        tr.className = `border-b border-slate-100 dark:border-slate-700 hover:bg-white/80 dark:hover:bg-slate-800 transition ${rowClass}`;
        tr.innerHTML = `
            <td class="p-4 text-xs font-mono text-yellow-500">${calculateStars(l)}</td>
            <td class="p-4">
                <div class="font-bold text-slate-800 dark:text-white">${l.nombre} ${corpBadge}</div>
                <div class="text-xs text-slate-500">${l.email}</div>
            </td>
            <td class="p-4">${courses}</td>
            <td class="p-4">
                <div class="text-xs text-slate-500 truncate max-w-[120px] cursor-pointer hover:text-blue-600" onclick="window.showFullMessage('${l.mensaje || ''}')">
                    ${l.mensaje ? '<i class="fa-regular fa-comment-dots mr-1"></i>' + l.mensaje : '-'}
                </div>
            </td>
            <td class="p-4">
                <div class="cursor-pointer text-xs text-slate-600 bg-yellow-50/50 p-1.5 rounded hover:bg-yellow-100 transition truncate max-w-[120px]" onclick="window.editNote('${l.id}', '${l.observaciones||''}')">
                    ${l.observaciones ? '📝 ' + l.observaciones : '<span class="opacity-50">+ Nota</span>'}
                </div>
            </td>
            <td class="p-4" onclick="window.setNextCall('${l.id}')">
                ${formatNextCall(l.proximo_llamado)}
            </td>
            <td class="p-4" onclick="window.managePurchases('${l.id}', '${l.compras||''}')">
                ${(l.compras||[]).map(c=>`<span class="text-[10px] bg-green-500 text-white px-1.5 rounded-full mr-1">✔ ${c}</span>`).join('') || '<span class="text-xs text-slate-300 hover:text-green-500 cursor-pointer">+</span>'}
            </td>
            <td class="p-4 text-center">
                <span onclick="window.toggleStatus('${l.id}', '${l.status}')" class="px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer hover:scale-105 inline-block transition shadow-sm ${l.status==='contactado' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">
                    ${l.status.toUpperCase()}
                </span>
            </td>
            ${customCells}
            <td class="p-4 text-center flex gap-2 justify-center">
                ${renderActions(l)}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderActions(l) {
    if(isTrashMode) {
        return `
            <button onclick="window.restoreLead('${l.id}')" class="w-8 h-8 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition"><i class="fa-solid fa-trash-arrow-up"></i></button>
            <button onclick="window.hardDelete('${l.id}')" class="w-8 h-8 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition"><i class="fa-solid fa-xmark"></i></button>
        `;
    }
    return `
        <button onclick="window.openCall('${l.telefono}')" class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white transition shadow-sm" title="Llamar"><i class="fa-solid fa-phone"></i></button>
        <button onclick="window.openWA('${l.telefono}','${l.nombre}','${l.curso_interes}')" class="w-8 h-8 rounded-full bg-green-50 text-green-600 hover:bg-green-500 hover:text-white transition shadow-sm" title="WhatsApp"><i class="fab fa-whatsapp text-lg"></i></button>
        <button onclick="window.openEmail('${l.email}','${l.nombre}','${l.curso_interes}')" class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-500 hover:text-white transition shadow-sm" title="Email"><i class="fa-solid fa-envelope"></i></button>
        <button onclick="window.trashLead('${l.id}')" class="w-8 h-8 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition"><i class="fa-solid fa-trash"></i></button>
    `;
}

// --- COLUMN WIZARD (CREAR COLUMNA) ---
window.addColumnWizard = async () => {
    // Paso 1: Nombre
    const { value: name } = await Swal.fire({
        title: 'Nueva Columna',
        input: 'text',
        inputPlaceholder: 'Ej. Dirección, Fecha Cumpleaños...',
        showCancelButton: true
    });
    if(!name) return;

    // Paso 2: Tipo
    const { value: type } = await Swal.fire({
        title: `Tipo de dato para "${name}"`,
        input: 'radio',
        inputOptions: {
            'text': '🔤 Texto Libre',
            'date': '📅 Fecha',
            'select': 'list Selección (Menú)'
        },
        inputValue: 'text',
        showCancelButton: true
    });
    if(!type) return;

    // Paso 3: Opciones (Solo si es select)
    let options = [];
    if(type === 'select') {
        const { value: opts } = await Swal.fire({
            title: 'Opciones del Menú',
            input: 'textarea',
            inputPlaceholder: 'Separa las opciones con comas.\nEj: Tarjeta, Efectivo, Transferencia',
            showCancelButton: true
        });
        if(opts) options = opts.split(',').map(s => s.trim());
    }

    // Guardar
    customColumns.push({ name, type, options });
    localStorage.setItem('crm_custom_cols_v2', JSON.stringify(customColumns));
    renderApp();
    Swal.fire('Columna Creada', '', 'success');
};

// Editar dato de columna custom
window.editCustomField = async (id, colName, type, currentVal) => {
    let result;
    const fieldPath = `custom_fields.${colName}`;

    if(type === 'text') {
        result = await Swal.fire({ input: 'text', title: colName, inputValue: currentVal });
    } else if(type === 'date') {
        result = await Swal.fire({ 
            title: colName, 
            html: `<input type="date" id="swal-date-input" class="swal2-input" value="${currentVal}">`,
            preConfirm: () => document.getElementById('swal-date-input').value
        });
    } else if(type === 'select') {
        // Buscar las opciones de esta columna
        const colDef = customColumns.find(c => c.name === colName);
        const optionsHTML = colDef.options.map(o => `<option value="${o}" ${o===currentVal?'selected':''}>${o}</option>`).join('');
        result = await Swal.fire({
            title: colName,
            html: `<select id="swal-select" class="swal2-input">${optionsHTML}</select>`,
            preConfirm: () => document.getElementById('swal-select').value
        });
    }

    if(result.isConfirmed || result.value) {
        await updateDoc(doc(db, "leads", id), { [fieldPath]: result.value });
    }
};

window.removeColumn = (idx) => {
    Swal.fire({
        title: '¿Borrar columna?',
        text: 'Los datos guardados no se borrarán de la base de datos, solo se ocultarán.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, ocultar'
    }).then(r => {
        if(r.isConfirmed) {
            customColumns.splice(idx, 1);
            localStorage.setItem('crm_custom_cols_v2', JSON.stringify(customColumns));
            renderApp();
        }
    });
};

// --- WHATSAPP CON VARIABLES MAGICAS ---
window.openWA = (phone, name, course) => {
    if(!phone) return Swal.fire('Sin teléfono');
    
    // Tarjetas de plantillas
    const cards = templates.whatsapp.map((t, i) => `
        <div onclick="selectWATemplate(${i}, '${phone}', '${name}', '${course}')" class="cursor-pointer bg-slate-50 border hover:border-green-500 hover:bg-green-50 p-3 rounded-lg text-left mb-2 transition">
            <div class="font-bold text-sm text-slate-800">${t.title}</div>
            <div class="text-xs text-slate-500 truncate">${t.text}</div>
        </div>
    `).join('');

    Swal.fire({
        title: 'Selecciona Mensaje',
        html: `<div class="max-h-60 overflow-y-auto">${cards}</div>`,
        showConfirmButton: false,
        showCloseButton: true
    });
};

window.selectWATemplate = async (idx, phone, name, course) => {
    Swal.close();
    // REEMPLAZO AUTOMÁTICO DE VARIABLES
    let rawText = templates.whatsapp[idx].text;
    let finalMsg = rawText
        .replace(/{nombre}/gi, name)
        .replace(/{curso}/gi, course || 'el curso');

    // Confirmar/Editar antes de enviar
    const { value: confirmedMsg } = await Swal.fire({
        title: 'Vista Previa',
        input: 'textarea',
        inputValue: finalMsg,
        confirmButtonText: 'Enviar WhatsApp <i class="fab fa-whatsapp"></i>',
        confirmButtonColor: '#25D366',
        showCancelButton: true
    });

    if(confirmedMsg) {
        const cleanPhone = phone.replace(/\D/g, '');
        const p = cleanPhone.length === 9 ? '56' + cleanPhone : cleanPhone;
        window.open(`https://wa.me/${p}?text=${encodeURIComponent(confirmedMsg)}`, '_blank');
    }
};

// --- LUPA DE MENSAJES ---
window.showFullMessage = (msg) => {
    if(!msg) return;
    Swal.fire({
        title: 'Mensaje del Cliente',
        text: msg,
        confirmButtonText: 'Cerrar'
    });
};

// --- OTROS HELPERS ---
window.switchView = (v) => {
    currentView = v;
    document.getElementById('view-table').classList.toggle('hidden', v !== 'table');
    document.getElementById('view-kanban').classList.toggle('hidden', v !== 'kanban');
    renderApp();
};

window.toggleTrash = () => {
    isTrashMode = !isTrashMode;
    const btn = document.getElementById('btn-trash');
    btn.classList.toggle('text-red-500', isTrashMode);
    btn.classList.toggle('bg-red-50', isTrashMode);
    renderApp();
    if(isTrashMode) Swal.fire({toast:true, title:'Modo Papelera: Viendo eliminados', icon:'warning', position:'top', showConfirmButton:false, timer:2000});
};

function calculateStars(l) {
    let s = 1;
    if(l.telefono) s++;
    if(l.mensaje && l.mensaje.length > 20) s++;
    if(isCorporate(l.email)) s+=2;
    return '⭐'.repeat(Math.min(s, 5));
}

function updateCourseFilter(set) {
    const sel = document.getElementById('filter-course');
    const val = sel.value;
    sel.innerHTML = '<option value="all">📚 Todos los cursos</option>';
    Array.from(set).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c; sel.appendChild(opt);
    });
    if(Array.from(set).includes(val)) sel.value = val;
}

// Configuración de Plantillas (Modal)
window.openConfig = async () => {
    const { value: type } = await Swal.fire({ title:'Gestionar Plantillas', input:'radio', inputOptions:{'whatsapp':'WhatsApp','email':'Email'}, inputValue:'whatsapp'});
    if(!type) return;
    
    // Render lista para borrar
    const listHtml = templates[type].map((t,i) => `
        <div class="flex justify-between items-center bg-slate-100 p-2 mb-2 rounded">
            <span class="text-xs font-bold">${t.title}</span>
            <button onclick="deleteTemplate('${type}',${i})" class="text-red-500"><i class="fa-solid fa-trash"></i></button>
        </div>
    `).join('');

    Swal.fire({
        title: `Plantillas ${type}`,
        html: `<div class="mb-4 text-left max-h-40 overflow-y-auto">${listHtml}</div>
               <button onclick="addTemplate('${type}')" class="bg-blue-500 text-white w-full py-2 rounded text-sm">+ Nueva Plantilla</button>`,
        showConfirmButton: false, showCloseButton: true
    });
};

window.addTemplate = async (type) => {
    Swal.close();
    const { value: f } = await Swal.fire({
        title: 'Nueva Plantilla',
        html: `<input id="swal-t" class="swal2-input" placeholder="Título"><textarea id="swal-b" class="swal2-textarea" placeholder="Usa {nombre} y {curso}"></textarea>`,
        preConfirm: () => ({ title: document.getElementById('swal-t').value, text: document.getElementById('swal-b').value })
    });
    if(f) {
        templates[type].push(f);
        localStorage.setItem('crm_templates', JSON.stringify(templates));
        Swal.fire('Guardado', '', 'success');
    }
};

window.deleteTemplate = (t, i) => {
    templates[t].splice(i, 1);
    localStorage.setItem('crm_templates', JSON.stringify(templates));
    Swal.close(); Swal.fire('Eliminado', '', 'success');
};

// Acciones simples
window.openCall = p => window.location.href = `tel:${p}`;
window.openEmail = (e,n,c) => window.location.href = `mailto:${e}`; // Simplificado, usar templates igual que WA si se desea
window.toggleStatus = async (id, s) => await updateDoc(doc(db,"leads",id), {status: s==='contactado'?'pendiente':'contactado'});
window.trashLead = async id => await updateDoc(doc(db,"leads",id), {status:'trashed'});
window.restoreLead = async id => await updateDoc(doc(db,"leads",id), {status:'pendiente'});
window.hardDelete = async id => await deleteDoc(doc(db,"leads",id));
window.editNote = async (id, val) => { const {value:v} = await Swal.fire({input:'textarea', inputValue:val, title:'Nota Interna'}); if(v!==undefined) updateDoc(doc(db,"leads",id),{observaciones:v}); };
window.setNextCall = async id => { const {value:d} = await Swal.fire({html:'<input type="datetime-local" class="swal2-input" id="d">', preConfirm:()=>document.getElementById('d').value}); if(d) updateDoc(doc(db,"leads",id),{proximo_llamado:d}); };
window.managePurchases = async (id, cur) => { /* Misma lógica checkboxes anterior */ };

function isCorporate(e) { return !['gmail.com','hotmail.com','outlook.com','yahoo.com'].some(d=>(e||'').includes(d)); }
function formatNextCall(d) { if(!d) return '<span class="text-slate-300 text-xs">Agendar</span>'; const date = new Date(d); return `<span class="text-xs font-bold ${date<new Date()?'text-red-500':'text-blue-500'}">${date.toLocaleDateString()}</span>`; }
function updateKPIs() { 
    const active = allLeads.filter(l=>l.status!=='trashed'); 
    document.getElementById('kpi-total').textContent = active.length;
    document.getElementById('kpi-pending').textContent = active.filter(l=>l.status==='pendiente').length;
    document.getElementById('kpi-contacted').textContent = active.filter(l=>l.status==='contactado').length;
}
function updateNotifications(list) {
    const el = document.getElementById('notif-list');
    el.innerHTML = '';
    if(list.length) {
        document.getElementById('notif-badge').classList.remove('hidden');
        list.forEach(l => {
            const d = document.createElement('div');
            d.className = "p-3 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer";
            d.innerHTML = `<div class="font-bold text-sm text-slate-700 dark:text-slate-200">${l.nombre}</div><div class="text-xs text-blue-500">${l.curso_interes}</div>`;
            d.onclick = () => { document.getElementById('search-input').value = l.email; renderApp(); };
            el.appendChild(d);
        });
    } else { document.getElementById('notif-badge').classList.add('hidden'); el.innerHTML='<div class="p-4 text-center text-xs text-slate-400">Sin pendientes urgentes</div>'; }
}
document.getElementById('notif-btn').onclick = (e) => { e.stopPropagation(); document.getElementById('notif-dropdown').classList.toggle('hidden'); };
window.onclick = () => document.getElementById('notif-dropdown').classList.add('hidden');

// Eventos Filtros
document.getElementById('search-input').onkeyup = renderApp;
document.getElementById('filter-course').onchange = renderApp;
document.getElementById('filter-date').onchange = renderApp;

// Dark Mode Init
if(localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
document.getElementById('theme-toggle').onclick = () => { document.documentElement.classList.toggle('dark'); localStorage.theme = document.documentElement.classList.contains('dark')?'dark':'light'; };

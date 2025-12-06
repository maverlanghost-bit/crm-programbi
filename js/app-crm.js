// ==========================================
// CONTROLADOR PRINCIPAL (MASTER V7 - SYNC REFORZADO)
// ==========================================

import { authService, leadsService, templatesService } from "./firebase-db.js";

// --- CONFIGURACIÓN ---
const SHOPIFY_API_URL = "https://crm-programbi.vercel.app/api/create-customer"; 

// === ESTADO DE LA APLICACIÓN ===
const state = {
    user: null,
    leads: [],
    templates: [], 
    view: 'table', 
    filters: {
        search: '',
        date: 'all',
        course: 'all'
    },
    trashMode: false,
    chartInstance: null,
    activeTemplateId: null 
};

// === INICIALIZACIÓN ===
document.addEventListener('DOMContentLoaded', () => {
    initAuthListener();
    initEventListeners();
    setTimeout(injectManualSyncButton, 1500);
});

function initAuthListener() {
    authService.onStateChange((user) => {
        state.user = user;
        if (user) {
            document.getElementById('login-view').classList.add('hidden');
            document.getElementById('dashboard-view').classList.remove('hidden');
            document.getElementById('user-display').textContent = user.email || 'Admin';
            
            subscribeToData();
        } else {
            document.getElementById('dashboard-view').classList.add('hidden');
            document.getElementById('login-view').classList.remove('hidden');
        }
    });
}

function subscribeToData() {
    // 1. LEADS
    leadsService.subscribe((data) => {
        state.leads = data;
        renderApp();
        
        // AUTO-SYNC MEJORADO: Atrapa 'pending' Y también los que no tienen estado (null/undefined)
        // Esto soluciona el problema de que los leads viejos se ignoren.
        syncNewLeadsOnly(data); 
    });

    // 2. PLANTILLAS
    templatesService.subscribe((data) => {
        state.templates = data;
        renderTemplatesList(); 
    });
}

// === MOTOR DE SINCRONIZACIÓN (SHOPIFY) ===

async function syncNewLeadsOnly(leads) {
    // Filtro más permisivo: Sincroniza si es 'pending' O si no tiene estado definido.
    const leadsToSync = leads.filter(l => 
        l.status !== 'trashed' && 
        (l.shopify_status === 'pending' || !l.shopify_status)
    );

    if (leadsToSync.length > 0) {
        console.log(`⚡ Auto-Sync: Procesando ${leadsToSync.length} leads...`);
        runBatchSync(leadsToSync, true); // Silencioso
    }
}

async function runBatchSync(leads, silent = false) {
    if (leads.length === 0) {
        if(!silent) Swal.fire('Estado', 'No hay leads pendientes de sincronizar.', 'info');
        return;
    }

    if (!silent) {
        Swal.fire({
            title: 'Conectando con Shopify...',
            html: `Enviando <b>${leads.length}</b> contactos.<br>Por favor espera...`,
            didOpen: () => Swal.showLoading()
        });
    }

    let successCount = 0;
    let errorCount = 0;

    for (const lead of leads) {
        try {
            // Data Cleaning Robusto
            const intereses = Array.isArray(lead.intereses) ? lead.intereses : [lead.curso_interes || 'General'];
            // Limpiamos tags agresivamente para evitar rechazos de Shopify
            const tags = intereses.map(i => 
                `curso-${String(i).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')}`
            ).join(', ');
            
            const payload = {
                nombre: lead.nombre || 'Desconocido',
                email: lead.email,
                telefono: lead.telefono || '',
                tags: `lead-web, crm-sync, ${tags}`,
                nota: `Empresa: ${lead.empresa || 'N/A'}\nMensaje: ${lead.mensaje || ''}\nOrigen: ${lead.origen || 'Web'}`
            };

            const res = await fetch(SHOPIFY_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // Manejo de respuesta seguro (evita crash si Vercel devuelve HTML de error)
            const text = await res.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (e) {
                throw new Error(`Respuesta inválida del servidor (Posible error 500): ${text.substring(0, 100)}...`);
            }

            if (res.ok) {
                await leadsService.update(lead.id, { 
                    shopify_status: 'synced',
                    shopify_id: result.customer?.id || 'ok',
                    shopify_synced_at: new Date()
                });
                successCount++;
            } else {
                console.error('Shopify Reject:', result);
                await leadsService.update(lead.id, { 
                    shopify_status: 'error', 
                    shopify_error: JSON.stringify(result) 
                });
                errorCount++;
            }
        } catch (error) {
            console.error(`Network/System Error ${lead.email}:`, error);
            await leadsService.update(lead.id, { 
                shopify_status: 'error_network', 
                shopify_error: error.message 
            });
            errorCount++;
        }
    }

    if (!silent) {
        Swal.fire({
            title: 'Proceso Finalizado',
            html: `✅ Enviados: <b>${successCount}</b><br>❌ Fallidos: <b style="color:red">${errorCount}</b><br><span style="font-size:12px">Revisa los iconos rojos en la tabla para ver el error.</span>`,
            icon: errorCount > 0 ? 'warning' : 'success'
        });
    }
}

// === RENDERIZADO PRINCIPAL ===
function renderApp() {
    const filteredLeads = filterLeads();
    
    updateKPIs(state.leads);
    updateChart(state.leads);
    toggleTrashBanner();

    if (state.view === 'table') {
        document.getElementById('view-table').classList.remove('hidden');
        document.getElementById('view-kanban').classList.add('hidden');
        renderTable(filteredLeads);
    } else {
        document.getElementById('view-table').classList.add('hidden');
        document.getElementById('view-kanban').classList.remove('hidden');
        renderKanban(filteredLeads);
    }

    updateViewButtons();
    updateTrashButtonState();
}

// === LÓGICA DE FILTRADO ===
function filterLeads() {
    return state.leads.filter(lead => {
        const isTrashed = lead.status === 'trashed';
        
        if (state.trashMode) {
            if (!isTrashed) return false;
        } else {
            if (isTrashed) return false;
        }

        const searchText = state.filters.search.toLowerCase();
        const leadName = (lead.nombre || '').toLowerCase();
        const leadEmail = (lead.email || '').toLowerCase();
        const matchText = leadName.includes(searchText) || leadEmail.includes(searchText);
        
        let leadInterestsStr = "";
        if(Array.isArray(lead.intereses)) leadInterestsStr = lead.intereses.join(' ').toLowerCase();
        else leadInterestsStr = (lead.curso_interes || '').toLowerCase();
        const matchCourse = state.filters.course === 'all' || leadInterestsStr.includes(state.filters.course.toLowerCase());

        let matchDate = true;
        if (lead.fecha && state.filters.date !== 'all') {
            try {
                const d = lead.fecha.toDate();
                const now = new Date();
                const diffDays = Math.ceil(Math.abs(now - d) / (1000 * 60 * 60 * 24)); 
                if (state.filters.date === 'today') matchDate = diffDays <= 1;
                if (state.filters.date === 'week') matchDate = diffDays <= 7;
                if (state.filters.date === 'month') matchDate = diffDays <= 30;
            } catch(e) { matchDate = true; } 
        }

        return matchText && matchCourse && matchDate;
    });
}

// === RENDERIZADO TABLA ===
function renderTable(leads) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    if (leads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400">
            ${state.trashMode ? 'La papelera está vacía' : 'No se encontraron resultados'}
        </td></tr>`;
        return;
    }

    leads.sort((a,b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));

    leads.forEach(lead => {
        try {
            const tr = document.createElement('tr');
            tr.className = `hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 transition fade-in ${isCorporate(lead.email) ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`;
            
            const matchingTemplate = findBestTemplate(lead);
            const hasTemplate = !!matchingTemplate;
            const isSent = lead.emailSent || false;
            
            // Icono Shopify con Tooltip de Error
            let shopifyIcon = '';
            let errorMsg = lead.shopify_error ? lead.shopify_error.replace(/"/g, "'") : "Error desconocido";
            
            if (lead.shopify_status === 'synced') {
                shopifyIcon = '<i class="fa-brands fa-shopify text-green-500 text-lg" title="Sincronizado OK"></i>';
            } else if (lead.shopify_status === 'error') {
                shopifyIcon = `<i class="fa-solid fa-circle-xmark text-red-500 text-lg cursor-help" title="Rechazado por Shopify: ${errorMsg}"></i>`;
            } else if (lead.shopify_status === 'error_network') {
                shopifyIcon = `<i class="fa-solid fa-wifi text-orange-500 text-lg cursor-help" title="Error de Red/Servidor: ${errorMsg}"></i>`;
            } else {
                shopifyIcon = '<i class="fa-solid fa-clock text-gray-300" title="Pendiente de Sincronización"></i>';
            }

            let btnClass = isSent ? "bg-blue-100 text-blue-600 border border-blue-300" : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700";
            
            let interesesDisplay = lead.curso_interes || 'General';
            if(Array.isArray(lead.intereses) && lead.intereses.length > 0) interesesDisplay = lead.intereses[0];

            tr.innerHTML = `
                <td class="p-4"><div class="flex items-center gap-1 text-yellow-400 text-xs">${'⭐'.repeat(calculateScore(lead))}</div></td>
                <td class="p-4">
                    <div class="flex items-center gap-2">
                        <div>
                            <div class="font-bold text-gray-800 dark:text-gray-200 text-sm">${lead.nombre || 'Sin nombre'}</div>
                            <div class="text-xs text-gray-500">${lead.email || 'Sin email'}</div>
                        </div>
                        ${shopifyIcon}
                    </div>
                </td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 truncate max-w-[100px] block">
                        ${interesesDisplay}
                    </span>
                </td>
                <td class="p-4 text-center">
                    <button class="status-badge px-3 py-1 rounded-full text-xs font-bold ${getStatusClass(lead.status)}" data-id="${lead.id}" data-status="${lead.status}">
                        ${(lead.status || 'pendiente').toUpperCase()}
                    </button>
                </td>
                <td class="p-4 text-center">
                    ${lead.observaciones ? `<i class="fa-solid fa-note-sticky text-yellow-500 cursor-help" title="${lead.observaciones}"></i>` : '<span class="text-gray-300">-</span>'}
                </td>
                <td class="p-4 flex justify-center gap-2">
                    ${state.trashMode ? `
                        <button class="action-restore text-green-500 hover:bg-green-100 p-2 rounded-full" data-id="${lead.id}" title="Restaurar"><i class="fa-solid fa-trash-arrow-up"></i></button>
                        <button class="action-delete text-red-600 hover:bg-red-100 p-2 rounded-full" data-id="${lead.id}" title="Eliminar Definitivo"><i class="fa-solid fa-xmark"></i></button>
                    ` : `
                        <button class="action-email w-8 h-8 rounded-full ${btnClass} transition flex items-center justify-center relative group" data-id="${lead.id}">
                            <i class="fa-solid fa-envelope"></i>
                            ${hasTemplate && !isSent ? '<span class="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full border border-white"></span>' : ''}
                        </button>
                        <button class="action-wa w-8 h-8 rounded-full bg-green-50 text-green-600 hover:bg-green-500 hover:text-white transition flex items-center justify-center" data-phone="${lead.telefono}" data-name="${lead.nombre}"><i class="fab fa-whatsapp"></i></button>
                        <button class="action-note w-8 h-8 rounded-full bg-yellow-50 text-yellow-600 hover:bg-yellow-400 hover:text-white transition flex items-center justify-center" data-id="${lead.id}" data-note="${lead.observaciones||''}"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-trash w-8 h-8 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition flex items-center justify-center" data-id="${lead.id}" title="Mover a Papelera"><i class="fa-solid fa-trash"></i></button>
                    `}
                </td>
            `;
            tbody.appendChild(tr);
        } catch (err) { console.error("Error fila:", err); }
    });

    attachDynamicListeners();
}

// === RENDERIZADO KANBAN ===
function renderKanban(leads) {
    const cols = {
        pendiente: document.getElementById('kanban-pending'),
        seguimiento: document.getElementById('kanban-progress'),
        contactado: document.getElementById('kanban-contacted')
    };
    
    if(!cols.pendiente) return; 
    Object.values(cols).forEach(c => c.innerHTML = '');

    document.getElementById('count-kanban-pending').innerText = leads.filter(l => (l.status||'pendiente') === 'pendiente').length;
    document.getElementById('count-kanban-progress').innerText = leads.filter(l => l.status === 'seguimiento').length;
    document.getElementById('count-kanban-contacted').innerText = leads.filter(l => l.status === 'contactado').length;

    leads.forEach(lead => {
        if(lead.status === 'trashed') return; 

        const st = lead.status || 'pendiente';
        const col = cols[st] || cols['pendiente'];
        
        const card = document.createElement('div');
        card.className = `bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-600 cursor-grab hover:shadow-md transition fade-in mb-3 ${isCorporate(lead.email) ? 'border-l-4 border-l-blue-500' : ''}`;
        card.setAttribute('data-id', lead.id);
        
        let shopifyIcon = '';
        if(lead.shopify_status === 'synced') shopifyIcon = '<i class="fa-brands fa-shopify text-green-500 text-xs"></i>';
        else if(lead.shopify_status === 'error') shopifyIcon = '<i class="fa-solid fa-circle-exclamation text-red-500 text-xs"></i>';
        else if(lead.shopify_status === 'error_network') shopifyIcon = '<i class="fa-solid fa-wifi text-orange-500 text-xs"></i>';
        
        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-bold text-sm text-gray-800 dark:text-gray-100 truncate w-32">${lead.nombre}</h4>
                <div class="flex gap-1 items-center">
                    ${shopifyIcon}
                    <span class="text-[10px] bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-500">${timeAgo(lead.fecha?.toDate ? lead.fecha.toDate() : null)}</span>
                </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">${lead.email}</p>
            <div class="flex items-center justify-between mt-3">
                 <span class="text-[10px] font-bold text-brand-600 bg-brand-50 dark:bg-brand-900/30 px-2 py-1 rounded truncate max-w-[100px]">${lead.curso_interes || 'Lead'}</span>
            </div>
        `;
        col.appendChild(card);
    });

    Object.values(cols).forEach(el => {
        new Sortable(el, {
            group: 'kanban', animation: 150, ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                if(state.trashMode) return;
                const id = evt.item.getAttribute('data-id');
                const newStatus = evt.to.getAttribute('data-status');
                if(id && newStatus) await leadsService.update(id, { status: newStatus });
            }
        });
    });
}

// === PLANTILLAS & EMAILS ===
function findBestTemplate(lead) {
    if (!lead) return null;
    const interests = Array.isArray(lead.intereses) ? lead.intereses : [lead.curso_interes];
    for(let interest of interests) {
        if(!interest) continue;
        const cleanInterest = String(interest).toLowerCase().trim();
        const match = state.templates.find(t => {
            const tName = (t.courseName || '').toLowerCase();
            return tName !== 'manual' && tName !== 'todos los cursos' && (tName.includes(cleanInterest) || cleanInterest.includes(tName));
        });
        if(match) return match;
    }
    return state.templates.find(t => t.courseName === 'Todos los Cursos');
}

function handleSmartEmail(leadId) {
    const lead = state.leads.find(l => l.id === leadId);
    if(!lead) return;

    const template = findBestTemplate(lead);

    if (template) {
        let rawBody = template.body.replace(/{nombre}/g, (lead.nombre || '').split(' ')[0]); 
        if (template.pdfLink) rawBody += `\n\nTemario: ${template.pdfLink}`;
        
        const body = rawBody.replace(/\n/g, "\r\n");
        const mailtoLink = `mailto:${lead.email}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(body)}`;
        
        Swal.fire({
            title: 'Vista Previa',
            html: `<div class="text-left text-xs p-4 bg-gray-50 border rounded whitespace-pre-wrap">${rawBody}</div>`,
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-paper-plane"></i> Abrir Correo'
        }).then((result) => {
            if (result.isConfirmed) {
                const link = document.createElement('a');
                link.href = mailtoLink;
                link.click();
                leadsService.update(leadId, { emailSent: true });
            }
        });
    } else {
        window.location.href = `mailto:${lead.email}`;
    }
}

// === GESTIÓN DE PLANTILLAS (UI) ===
function openEmailConfigModal() {
    document.getElementById('email-config-modal').classList.remove('hidden');
    renderTemplatesList();
    if (!state.activeTemplateId) resetEditor();
}

function renderTemplatesList() {
    const container = document.getElementById('templates-list');
    container.innerHTML = '';
    
    if (state.templates.length === 0) {
        container.innerHTML = '<div class="p-4 text-xs text-gray-400 text-center">Sin plantillas</div>';
        return;
    }

    state.templates.forEach(tpl => {
        const div = document.createElement('div');
        div.className = `email-sidebar-item p-3 rounded-lg cursor-pointer flex justify-between items-center mb-1 ${state.activeTemplateId === tpl.id ? 'active' : ''}`;
        div.innerHTML = `<p class="font-bold text-sm text-gray-700 dark:text-gray-200 truncate">${tpl.courseName}</p>`;
        div.onclick = () => loadTemplateEditor(tpl);
        container.appendChild(div);
    });
}

function loadTemplateEditor(tpl) {
    state.activeTemplateId = tpl ? tpl.id : null;
    document.getElementById('template-editor').classList.remove('hidden');
    document.getElementById('template-empty-state').classList.add('hidden');

    document.getElementById('tpl-course').value = tpl ? tpl.courseName : '';
    document.getElementById('tpl-subject').value = tpl ? tpl.subject : '';
    document.getElementById('tpl-link').value = tpl ? tpl.pdfLink : '';
    document.getElementById('tpl-body').value = tpl ? tpl.body : '';
    document.getElementById('tpl-auto').checked = tpl ? tpl.autoSend : false;
    
    updatePreview();

    const delBtn = document.getElementById('btn-delete-template');
    if (tpl) {
        delBtn.classList.remove('hidden');
        delBtn.onclick = async () => {
            if((await Swal.fire({title:'¿Eliminar?', icon:'warning', showCancelButton:true})).isConfirmed) {
                await templatesService.delete(tpl.id);
                resetEditor();
            }
        };
    } else delBtn.classList.add('hidden');
}

function resetEditor() {
    state.activeTemplateId = null;
    document.getElementById('template-editor').classList.add('hidden');
    document.getElementById('template-empty-state').classList.remove('hidden');
    document.getElementById('tpl-course').value = "";
    ['tpl-subject', 'tpl-link', 'tpl-body'].forEach(id => document.getElementById(id).value = '');
}

function updatePreview() {
    document.getElementById('preview-subject').textContent = document.getElementById('tpl-subject').value || 'Asunto';
    document.getElementById('preview-body').textContent = document.getElementById('tpl-body').value || 'Cuerpo del correo...';
    
    const link = document.getElementById('tpl-link').value;
    const att = document.getElementById('preview-attachment');
    if(link) { att.classList.remove('hidden'); att.classList.add('flex'); }
    else { att.classList.add('hidden'); att.classList.remove('flex'); }
}

async function saveCurrentTemplate() {
    const btn = document.getElementById('btn-save-template');
    btn.innerHTML = 'Guardando...'; btn.disabled = true;

    const data = {
        courseName: document.getElementById('tpl-course').value,
        subject: document.getElementById('tpl-subject').value,
        pdfLink: document.getElementById('tpl-link').value,
        body: document.getElementById('tpl-body').value,
        autoSend: document.getElementById('tpl-auto').checked
    };

    try {
        await templatesService.save(state.activeTemplateId, data);
        Swal.fire({toast: true, icon: 'success', title: 'Guardado', position: 'top-end', timer: 1500});
        if (!state.activeTemplateId) resetEditor();
    } catch (e) { Swal.fire('Error', e.message, 'error'); }
    finally { btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar Plantilla'; btn.disabled = false; }
}

// === AUXILIARES (KPI, Chart, UI) ===
function updateKPIs(leads) {
    const active = leads.filter(l => l.status !== 'trashed');
    if(document.getElementById('kpi-total')) document.getElementById('kpi-total').textContent = active.length;
    if(document.getElementById('kpi-pending')) document.getElementById('kpi-pending').textContent = active.filter(l => (l.status||'pendiente') === 'pendiente').length;
    if(document.getElementById('kpi-contacted')) document.getElementById('kpi-contacted').textContent = active.filter(l => l.status === 'contactado').length;
}

function updateChart(leads) {
    const ctx = document.getElementById('trendChart')?.getContext('2d');
    if(!ctx) return;
    const labels = [], dataPoints = [];
    for(let i=6; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('es', {weekday:'short'}));
        const dayStart = new Date(d.setHours(0,0,0,0));
        const dayEnd = new Date(d.setHours(23,59,59,999));
        
        const count = leads.filter(l => {
            if(!l.fecha) return false;
            try {
                const ld = l.fecha.toDate();
                return ld >= dayStart && ld <= dayEnd;
            } catch(e) { return false; }
        }).length;
        dataPoints.push(count);
    }
    if(state.chartInstance) state.chartInstance.destroy();
    state.chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Leads', data: dataPoints, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: {display:false} }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

function updateViewButtons() {
    const btnTable = document.getElementById('btn-view-table');
    const btnKanban = document.getElementById('btn-view-kanban');
    const activeClass = "px-4 py-2 rounded-lg text-sm font-bold bg-brand-600 text-white shadow-sm transition";
    const inactiveClass = "px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 transition";
    btnTable.className = state.view === 'table' ? activeClass : inactiveClass;
    btnKanban.className = state.view === 'kanban' ? activeClass : inactiveClass;
}

function updateTrashButtonState() {
    const trashBtn = document.getElementById('btn-trash');
    if (state.trashMode) {
        trashBtn.classList.add('text-red-600', 'bg-red-100', 'ring-2', 'ring-red-400');
        trashBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i>'; 
        trashBtn.title = "Salir de Papelera (Ver Activos)";
    } else {
        trashBtn.classList.remove('text-red-600', 'bg-red-100', 'ring-2', 'ring-red-400');
        trashBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        trashBtn.title = "Ver Papelera";
    }
}

function toggleTrashBanner() {
    let banner = document.getElementById('trash-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'trash-banner';
        banner.className = 'hidden bg-red-50 border-b border-red-100 text-red-600 text-center py-2 text-sm font-bold flex items-center justify-center gap-2 mb-4 rounded-xl';
        banner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ESTÁS VIENDO LA PAPELERA DE RECICLAJE (Archivos Eliminados)';
        const container = document.querySelector('main > div.relative');
        if (container) container.parentNode.insertBefore(banner, container);
    }
    state.trashMode ? banner.classList.remove('hidden') : banner.classList.add('hidden');
}

function isCorporate(email) {
    return !['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'].some(d => (email || '').includes(d));
}

function timeAgo(date) {
    if(!date) return '';
    try {
        const seconds = Math.floor((new Date() - date) / 1000);
        const intervals = { año: 31536000, mes: 2592000, día: 86400, h: 3600, min: 60 };
        for (let [unit, sec] of Object.entries(intervals)) {
            const val = Math.floor(seconds / sec);
            if (val >= 1) return `${val} ${unit}${val>1 && unit.length>3 ? 's' : ''}`;
        }
        return "Ahora";
    } catch(e) { return ""; }
}

function calculateScore(lead) {
    let score = 1;
    if(lead.telefono) score++;
    if(lead.mensaje && lead.mensaje.length > 10) score++;
    if(isCorporate(lead.email)) score += 2;
    return Math.min(score, 5);
}

function getStatusClass(s) {
    const map = {
        'contactado': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
        'seguimiento': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
        'trashed': 'bg-red-100 text-red-700',
        'pendiente': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
    };
    return map[s] || map['pendiente'];
}

function attachDynamicListeners() {
    // Email
    document.querySelectorAll('.action-email').forEach(btn => {
        btn.onclick = () => handleSmartEmail(btn.getAttribute('data-id'));
    });
    // Status Toggle
    document.querySelectorAll('.status-badge').forEach(badge => {
        badge.onclick = async () => {
            const id = badge.getAttribute('data-id');
            const next = badge.getAttribute('data-status') === 'contactado' ? 'pendiente' : 'contactado';
            await leadsService.update(id, { status: next });
        };
    });
    // Mover a Papelera
    document.querySelectorAll('.action-trash').forEach(btn => {
        btn.onclick = () => leadsService.moveToTrash(btn.getAttribute('data-id'));
    });
    // Restaurar desde Papelera
    document.querySelectorAll('.action-restore').forEach(btn => {
        btn.onclick = () => leadsService.update(btn.getAttribute('data-id'), { status: 'pendiente' });
    });
    // Borrado Definitivo
    document.querySelectorAll('.action-delete').forEach(btn => {
        btn.onclick = async () => {
            if((await Swal.fire({title:'¿Borrar para siempre?', icon:'warning', showCancelButton:true})).isConfirmed) 
                leadsService.deletePermanent(btn.getAttribute('data-id'));
        };
    });
    // Notas
    document.querySelectorAll('.action-note').forEach(btn => {
        btn.onclick = async () => {
            const { value } = await Swal.fire({input: 'textarea', inputValue: btn.getAttribute('data-note'), title: 'Nota'});
            if(value !== undefined) leadsService.update(btn.getAttribute('data-id'), { observaciones: value });
        };
    });
    // WhatsApp
    document.querySelectorAll('.action-wa').forEach(btn => {
        btn.onclick = () => {
            const p = btn.getAttribute('data-phone');
            if(p) window.open(`https://wa.me/${p.replace(/\D/g, '')}`, '_blank');
            else Swal.fire('Sin teléfono', '', 'info');
        };
    });
}

function injectManualSyncButton() {
    const toolbar = document.querySelector('.flex.items-center.gap-2.w-full.sm\\:w-auto.justify-end');
    if(toolbar && !document.getElementById('btn-manual-sync')) {
        const btn = document.createElement('button');
        btn.id = 'btn-manual-sync';
        // Botón verde llamativo
        btn.className = "bg-green-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-green-700 ml-2 shadow-lg flex items-center gap-2";
        btn.innerHTML = "<i class='fa-solid fa-rotate'></i> Sincronizar Todo (Forzar)";
        
        btn.onclick = () => {
            // Forzar sync manual de todo lo que falte (ignore status)
            const allPending = state.leads.filter(l => l.shopify_status !== 'synced');
            runBatchSync(allPending, false); 
        };
        
        toolbar.prepend(btn);
    }
}

// === LISTENERS GENERALES ===
function initEventListeners() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await authService.login(
            document.getElementById('login-email').value,
            document.getElementById('login-password').value
        );
        if (!res.success) Swal.fire('Error', 'Credenciales incorrectas', 'error');
    });
    document.getElementById('logout-btn').onclick = () => authService.logout();

    // Filtros
    document.getElementById('search-input').onkeyup = (e) => { state.filters.search = e.target.value; renderApp(); };
    document.getElementById('filter-date').onchange = (e) => { state.filters.date = e.target.value; renderApp(); };
    document.getElementById('filter-course').onchange = (e) => { state.filters.course = e.target.value; renderApp(); };
    
    // Vistas
    document.getElementById('btn-view-table').onclick = () => { state.view = 'table'; renderApp(); };
    document.getElementById('btn-view-kanban').onclick = () => { state.view = 'kanban'; renderApp(); };
    
    // Botón Papelera
    document.getElementById('btn-trash').onclick = () => { 
        state.trashMode = !state.trashMode; 
        renderApp(); 
    };

    // Modal Email
    document.getElementById('btn-config-email').onclick = openEmailConfigModal;
    document.getElementById('modal-backdrop-close').onclick = () => document.getElementById('email-config-modal').classList.add('hidden');
    document.getElementById('btn-close-modal').onclick = () => document.getElementById('email-config-modal').classList.add('hidden');
    document.getElementById('btn-new-template').onclick = () => loadTemplateEditor(null);
    document.getElementById('btn-save-template').onclick = saveCurrentTemplate;

    ['tpl-subject', 'tpl-body', 'tpl-link'].forEach(id => {
        document.getElementById(id)?.addEventListener('keyup', updatePreview);
    });
}

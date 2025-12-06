// ==========================================
// CONTROLADOR PRINCIPAL (MAIN APP LOGIC) - V3 FINAL
// ==========================================

import { authService, leadsService, templatesService } from "./firebase-db.js";

// --- CONFIGURACIÓN ---
// Asegúrate de que esta URL sea correcta y tu proyecto Vercel esté activo
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
    injectSyncButton(); // Inyectar botón manual
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
    // 1. Suscripción a Leads
    leadsService.subscribe((data) => {
        state.leads = data;
        renderApp();
        
        // Intentar sincronización automática silenciosa
        // (Solo si hay nuevos pendientes)
        syncPendingLeadsToShopify(data, true); 
    });

    // 2. Suscripción a Plantillas
    templatesService.subscribe((data) => {
        state.templates = data;
        renderTemplatesList(); 
        renderApp(); 
    });
}

// === LÓGICA DE SINCRONIZACIÓN SHOPIFY (NÚCLEO) ===
async function syncPendingLeadsToShopify(leads, silent = false) {
    // 1. Filtrar leads que necesitan ir a Shopify
    // Deben no estar borrados y tener status 'pending' O 'error_network' (para reintentar)
    const pendingLeads = leads.filter(l => 
        l.status !== 'trashed' && 
        (l.shopify_status === 'pending' || l.shopify_status === 'error_network')
    );

    if (pendingLeads.length === 0) {
        if(!silent) Swal.fire('Todo al día', 'No hay leads pendientes de sincronizar.', 'success');
        return;
    }

    if (!silent) {
        Swal.fire({
            title: 'Sincronizando...',
            text: `Procesando ${pendingLeads.length} leads con Shopify`,
            didOpen: () => Swal.showLoading()
        });
    } else {
        console.log(`🔄 Auto-Sync: ${pendingLeads.length} leads detectados.`);
    }

    let successCount = 0;
    let errorCount = 0;

    // 2. Procesar Cola
    for (const lead of pendingLeads) {
        try {
            // Normalizar intereses para tags
            const rawIntereses = Array.isArray(lead.intereses) ? lead.intereses : [lead.curso_interes || 'General'];
            // Limpiar tags: espacios a guiones, minusculas
            const tagsIntereses = rawIntereses.map(i => {
                return `curso-${String(i).toLowerCase().trim().replace(/\s+/g, '-')}`;
            }).join(', ');
            
            const payload = {
                nombre: lead.nombre || 'Sin Nombre',
                email: lead.email,
                telefono: lead.telefono || '',
                // Tags formateados para Shopify
                tags: `lead-web, crm-sync, ${tagsIntereses}`, 
                nota: `Empresa: ${lead.empresa || 'N/A'}\nIntereses: ${rawIntereses.join(', ')}\nMensaje: ${lead.mensaje || ''}\nOrigen: ${lead.origen || 'Web'}`
            };

            console.log(`📤 Enviando a Vercel [${lead.email}]:`, payload);

            // Fetch a Vercel
            const res = await fetch(SHOPIFY_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();

            if (res.ok) {
                // ÉXITO
                await leadsService.update(lead.id, { 
                    shopify_status: 'synced',
                    shopify_id: result.customer?.id || 'synced-ok',
                    shopify_synced_at: new Date()
                });
                successCount++;
                console.log(`✅ Éxito: ${lead.email}`);
            } else {
                // ERROR DE API (Shopify rechazó datos, ej: email inválido)
                console.error('❌ Shopify rechazó:', result);
                await leadsService.update(lead.id, { 
                    shopify_status: 'error', 
                    shopify_error: JSON.stringify(result) 
                });
                errorCount++;
            }

        } catch (error) {
            // ERROR DE RED (Vercel caído, CORS, Sin Internet)
            console.error(`❌ Error de RED con ${lead.email}:`, error);
            await leadsService.update(lead.id, { 
                shopify_status: 'error_network', 
                shopify_error: error.message 
            });
            errorCount++;
        }
    }

    if (!silent) {
        Swal.fire({
            title: 'Sincronización Terminada',
            html: `Enviados: <b>${successCount}</b><br>Errores: <b style="color:red">${errorCount}</b>`,
            icon: errorCount > 0 ? 'warning' : 'success'
        });
    }
}

// === HELPER: BOTÓN MANUAL ===
function injectSyncButton() {
    // Busca la barra de herramientas
    const toolbar = document.querySelector('.flex.items-center.gap-2.w-full.sm\\:w-auto.justify-end');
    if(toolbar && !document.getElementById('btn-manual-sync')) {
        const btn = document.createElement('button');
        btn.id = 'btn-manual-sync';
        btn.className = "px-4 py-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm font-bold hover:bg-green-100 transition flex items-center gap-2 mr-2";
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> <span class="hidden sm:inline">Sincronizar</span>';
        btn.onclick = () => syncPendingLeadsToShopify(state.leads, false);
        
        // Insertar al principio de la barra
        toolbar.prepend(btn);
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

// ... (Resto de funciones auxiliares iguales: updateTrashButtonState, toggleTrashBanner, filterLeads) ...
function updateTrashButtonState() {
    const trashBtn = document.getElementById('btn-trash');
    if (state.trashMode) {
        trashBtn.classList.add('text-red-600', 'bg-red-100', 'ring-2', 'ring-red-400');
        trashBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i>'; 
        trashBtn.title = "Salir de Papelera";
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
        banner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ESTÁS VIENDO LA PAPELERA DE RECICLAJE';
        const container = document.querySelector('main > div.relative');
        if (container) container.parentNode.insertBefore(banner, container);
    }
    state.trashMode ? banner.classList.remove('hidden') : banner.classList.add('hidden');
}

function filterLeads() {
    return state.leads.filter(lead => {
        if (state.trashMode) { if (lead.status !== 'trashed') return false; } 
        else { if (lead.status === 'trashed') return false; }

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
            const d = lead.fecha.toDate();
            const now = new Date();
            const diffDays = Math.ceil(Math.abs(now - d) / (1000 * 60 * 60 * 24)); 
            if (state.filters.date === 'today') matchDate = diffDays <= 1;
            if (state.filters.date === 'week') matchDate = diffDays <= 7;
            if (state.filters.date === 'month') matchDate = diffDays <= 30;
        }

        return matchText && matchCourse && matchDate;
    });
}

// === RENDERIZADO TABLA (ACTUALIZADO CON ICONOS DE ERROR) ===
function renderTable(leads) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    if (leads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400">
            ${state.trashMode ? 'La papelera está vacía' : 'No se encontraron resultados'}
        </td></tr>`;
        return;
    }

    leads.forEach(lead => {
        try {
            const tr = document.createElement('tr');
            tr.className = `hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 transition fade-in ${isCorporate(lead.email) ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`;
            
            const matchingTemplate = findBestTemplate(lead);
            const hasTemplate = !!matchingTemplate;
            const isSent = lead.emailSent || false;
            
            // LÓGICA DE ICONOS SHOPIFY MEJORADA
            let shopifyIcon = '';
            if (lead.shopify_status === 'synced') {
                shopifyIcon = '<i class="fa-brands fa-shopify text-green-500 text-lg" title="Sincronizado OK"></i>';
            } else if (lead.shopify_status === 'error') {
                // Error de API (Shopify dijo no)
                shopifyIcon = '<i class="fa-solid fa-circle-xmark text-red-500 text-lg cursor-help" title="Shopify rechazó los datos (Ver Consola)"></i>';
            } else if (lead.shopify_status === 'error_network') {
                // Error de Red (No se pudo conectar)
                shopifyIcon = '<i class="fa-solid fa-wifi text-orange-500 text-lg cursor-help" title="Error de Conexión con Vercel/Shopify"></i>';
            } else if (lead.shopify_status === 'pending') {
                shopifyIcon = '<i class="fa-solid fa-arrows-rotate fa-spin text-blue-400 text-lg" title="Intentando sincronizar..."></i>';
            } else {
                shopifyIcon = '<i class="fa-brands fa-shopify text-gray-200 text-lg" title="No sincronizado"></i>';
            }

            let btnClass = isSent ? "bg-blue-100 text-blue-600 border border-blue-300" : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700";
            
            let interesesDisplay = lead.curso_interes || 'General';
            if(Array.isArray(lead.intereses) && lead.intereses.length > 0) {
                interesesDisplay = lead.intereses.slice(0, 2).join(', ') + (lead.intereses.length > 2 ? '...' : '');
            }

            tr.innerHTML = `
                <td class="p-4"><div class="flex items-center gap-1 text-yellow-400 text-xs">${'⭐'.repeat(calculateScore(lead))}</div></td>
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <div>
                            <div class="font-bold text-gray-800 dark:text-gray-200">${lead.nombre || 'Sin nombre'}</div>
                            <div class="text-xs text-gray-500">${lead.email || 'Sin email'}</div>
                        </div>
                        ${shopifyIcon}
                    </div>
                </td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
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
                        <button class="action-restore text-green-500 hover:bg-green-100 p-2 rounded-full" data-id="${lead.id}"><i class="fa-solid fa-trash-arrow-up"></i></button>
                        <button class="action-delete text-red-600 hover:bg-red-100 p-2 rounded-full" data-id="${lead.id}"><i class="fa-solid fa-xmark"></i></button>
                    ` : `
                        <button class="action-email w-8 h-8 rounded-full ${btnClass} transition flex items-center justify-center relative group" 
                                data-id="${lead.id}">
                            <i class="fa-solid fa-envelope"></i>
                            ${hasTemplate && !isSent ? '<span class="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full border border-white"></span>' : ''}
                        </button>
                        <button class="action-wa w-8 h-8 rounded-full bg-green-50 text-green-600 hover:bg-green-500 hover:text-white transition flex items-center justify-center" data-phone="${lead.telefono}" data-name="${lead.nombre}"><i class="fab fa-whatsapp"></i></button>
                        <button class="action-note w-8 h-8 rounded-full bg-yellow-50 text-yellow-600 hover:bg-yellow-400 hover:text-white transition flex items-center justify-center" data-id="${lead.id}" data-note="${lead.observaciones||''}"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-trash w-8 h-8 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition flex items-center justify-center" data-id="${lead.id}"><i class="fa-solid fa-trash"></i></button>
                    `}
                </td>
            `;
            tbody.appendChild(tr);
        } catch (err) { console.error("Error fila:", err); }
    });

    attachDynamicListeners();
}

// ... (El resto de funciones como renderKanban, findBestTemplate, etc. permanecen igual que en tu versión anterior, solo asegúrate de que el archivo termine correctamente) ...

// === RENDERIZADO KANBAN ===
function renderKanban(leads) {
    const cols = {
        pendiente: document.getElementById('kanban-pending'),
        seguimiento: document.getElementById('kanban-progress'),
        contactado: document.getElementById('kanban-contacted')
    };
    
    if(!cols.pendiente) return; 
    Object.values(cols).forEach(c => c.innerHTML = '');

    document.getElementById('count-kanban-pending').innerText = leads.filter(l => l.status === 'pendiente').length;
    document.getElementById('count-kanban-progress').innerText = leads.filter(l => l.status === 'seguimiento').length;
    document.getElementById('count-kanban-contacted').innerText = leads.filter(l => l.status === 'contactado').length;

    leads.forEach(lead => {
        const col = cols[lead.status] || cols['pendiente'];
        const card = document.createElement('div');
        card.className = `bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-600 cursor-grab hover:shadow-md transition fade-in mb-3 ${isCorporate(lead.email) ? 'border-l-4 border-l-blue-500' : ''}`;
        card.setAttribute('data-id', lead.id);
        
        let interesesDisplay = Array.isArray(lead.intereses) ? lead.intereses[0] : (lead.curso_interes || 'General');

        let shopifyStatusClass = 'text-gray-300';
        if(lead.shopify_status === 'synced') shopifyStatusClass = 'text-green-500';
        if(lead.shopify_status === 'error') shopifyStatusClass = 'text-red-500';
        if(lead.shopify_status === 'error_network') shopifyStatusClass = 'text-orange-500';

        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-bold text-sm text-gray-800 dark:text-gray-100 truncate w-32">${lead.nombre}</h4>
                <div class="flex gap-1">
                    <span class="${shopifyStatusClass} text-xs"><i class="fa-brands fa-shopify"></i></span>
                    <span class="text-[10px] bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-500">${timeAgo(lead.fecha?.toDate())}</span>
                </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">${lead.email}</p>
            <div class="flex items-center justify-between mt-3">
                 <span class="text-[10px] font-bold text-brand-600 bg-brand-50 dark:bg-brand-900/30 px-2 py-1 rounded truncate max-w-[120px]">${interesesDisplay}</span>
                 ${lead.status === 'trashed' ? '<span class="text-xs bg-red-100 text-red-600 px-1 rounded">DEL</span>' : ''}
            </div>
        `;
        
        if (lead.status === 'trashed') cols['pendiente'].appendChild(card);
        else col.appendChild(card);
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
            confirmButtonText: 'Abrir Correo'
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
            if(confirm('¿Eliminar plantilla?')) {
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
    document.getElementById('search-input').onkeyup = (e) => { state.filters.search = e.target.value; renderApp(); };
    document.getElementById('filter-date').onchange = (e) => { state.filters.date = e.target.value; renderApp(); };
    document.getElementById('filter-course').onchange = (e) => { state.filters.course = e.target.value; renderApp(); };
    document.getElementById('btn-view-table').onclick = () => { state.view = 'table'; renderApp(); };
    document.getElementById('btn-view-kanban').onclick = () => { state.view = 'kanban'; renderApp(); };
    document.getElementById('btn-trash').onclick = () => { state.trashMode = !state.trashMode; renderApp(); };
    document.getElementById('btn-config-email').onclick = openEmailConfigModal;
    document.getElementById('modal-backdrop-close').onclick = () => document.getElementById('email-config-modal').classList.add('hidden');
    document.getElementById('btn-close-modal').onclick = () => document.getElementById('email-config-modal').classList.add('hidden');
    document.getElementById('btn-new-template').onclick = () => loadTemplateEditor(null);
    document.getElementById('btn-save-template').onclick = saveCurrentTemplate;
    ['tpl-subject', 'tpl-body', 'tpl-link'].forEach(id => {
        document.getElementById(id)?.addEventListener('keyup', updatePreview);
    });
}

function updateKPIs(leads) {
    const active = leads.filter(l => l.status !== 'trashed');
    document.getElementById('kpi-total').textContent = active.length;
    document.getElementById('kpi-pending').textContent = active.filter(l => l.status === 'pendiente').length;
    document.getElementById('kpi-contacted').textContent = active.filter(l => l.status === 'contactado').length;
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
            const ld = l.fecha.toDate();
            return ld >= dayStart && ld <= dayEnd;
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

function isCorporate(email) {
    return !['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'].some(d => (email || '').includes(d));
}

function timeAgo(date) {
    if(!date) return '';
    const seconds = Math.floor((new Date() - date) / 1000);
    const intervals = { año: 31536000, mes: 2592000, día: 86400, h: 3600, min: 60 };
    for (let [unit, sec] of Object.entries(intervals)) {
        const val = Math.floor(seconds / sec);
        if (val >= 1) return `${val} ${unit}${val>1 && unit.length>3 ? 's' : ''}`;
    }
    return "Ahora";
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
        'contactado': 'bg-green-100 text-green-700',
        'seguimiento': 'bg-blue-100 text-blue-700',
        'trashed': 'bg-red-100 text-red-700',
        'pendiente': 'bg-yellow-100 text-yellow-700'
    };
    return map[s] || map['pendiente'];
}

function attachDynamicListeners() {
    document.querySelectorAll('.action-email').forEach(btn => btn.onclick = () => handleSmartEmail(btn.getAttribute('data-id')));
    document.querySelectorAll('.status-badge').forEach(badge => {
        badge.onclick = async () => {
            const id = badge.getAttribute('data-id');
            const next = badge.getAttribute('data-status') === 'contactado' ? 'pendiente' : 'contactado';
            await leadsService.update(id, { status: next });
        };
    });
    document.querySelectorAll('.action-trash').forEach(btn => leadsService.moveToTrash(btn.getAttribute('data-id')));
    document.querySelectorAll('.action-restore').forEach(btn => leadsService.update(btn.getAttribute('data-id'), { status: 'pendiente' }));
    document.querySelectorAll('.action-delete').forEach(btn => {
        btn.onclick = async () => {
            if((await Swal.fire({title:'¿Eliminar?', icon:'warning', showCancelButton:true})).isConfirmed) 
                leadsService.deletePermanent(btn.getAttribute('data-id'));
        };
    });
    document.querySelectorAll('.action-note').forEach(btn => {
        btn.onclick = async () => {
            const { value } = await Swal.fire({input: 'textarea', inputValue: btn.getAttribute('data-note'), title: 'Nota'});
            if(value !== undefined) leadsService.update(btn.getAttribute('data-id'), { observaciones: value });
        };
    });
    document.querySelectorAll('.action-wa').forEach(btn => {
        btn.onclick = () => {
            const p = btn.getAttribute('data-phone');
            if(p) window.open(`https://wa.me/${p.replace(/\D/g, '')}`, '_blank');
            else Swal.fire('Sin teléfono', '', 'info');
        };
    });
}

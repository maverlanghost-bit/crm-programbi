// ==========================================
// CONTROLADOR PRINCIPAL (MAIN APP LOGIC)
// ==========================================

import { authService, leadsService, templatesService } from "./firebase-db.js";

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
    leadsService.subscribe((data) => {
        state.leads = data;
        renderApp();
    });

    templatesService.subscribe((data) => {
        state.templates = data;
        renderTemplatesList(); 
        renderApp(); 
    });
}

// === RENDERIZADO PRINCIPAL ===
function renderApp() {
    // 1. Filtrar los leads según el estado (Activos o Papelera)
    const filteredLeads = filterLeads();
    
    // 2. Actualizar KPIs y Gráficos (Siempre con datos globales activos)
    updateKPIs(state.leads);
    updateChart(state.leads);
    
    // 3. Aviso Visual de Papelera
    toggleTrashBanner();

    // 4. Renderizar Vistas
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
    
    // 5. Estado del Botón Papelera
    const trashBtn = document.getElementById('btn-trash');
    if (state.trashMode) {
        trashBtn.classList.add('text-red-600', 'bg-red-100', 'ring-2', 'ring-red-400');
        trashBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i>'; // Icono cambiar a "ver activos"
        trashBtn.title = "Salir de Papelera (Ver Activos)";
    } else {
        trashBtn.classList.remove('text-red-600', 'bg-red-100', 'ring-2', 'ring-red-400');
        trashBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        trashBtn.title = "Ver Papelera";
    }
}

// === NUEVO: BANNER DE PAPELERA ===
function toggleTrashBanner() {
    let banner = document.getElementById('trash-banner');
    if (!banner) {
        // Crear banner si no existe
        banner = document.createElement('div');
        banner.id = 'trash-banner';
        banner.className = 'hidden bg-red-50 border-b border-red-100 text-red-600 text-center py-2 text-sm font-bold flex items-center justify-center gap-2 mb-4 rounded-xl';
        banner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ESTÁS VIENDO LA PAPELERA DE RECICLAJE (Archivos Eliminados)';
        // Insertar antes de la tabla/kanban container
        const container = document.querySelector('main > div.relative');
        if (container) container.parentNode.insertBefore(banner, container);
    }

    if (state.trashMode) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
}

// === LÓGICA DE FILTROS ===
function filterLeads() {
    return state.leads.filter(lead => {
        // Lógica estricta de Papelera vs Activos
        if (state.trashMode) {
            // Si estoy en modo papelera, SOLO mostrar 'trashed'
            if (lead.status !== 'trashed') return false;
        } else {
            // Si estoy en modo normal, OCULTAR 'trashed'
            if (lead.status === 'trashed') return false;
        }

        // Filtros de Texto y Fecha
        const searchText = state.filters.search.toLowerCase();
        const leadName = (lead.nombre || '').toLowerCase();
        const leadEmail = (lead.email || '').toLowerCase();
        
        const matchText = leadName.includes(searchText) || leadEmail.includes(searchText);
        
        const matchCourse = state.filters.course === 'all' || (lead.curso_interes || '').includes(state.filters.course);

        let matchDate = true;
        if (lead.fecha && state.filters.date !== 'all') {
            const d = lead.fecha.toDate();
            const now = new Date();
            const diffTime = Math.abs(now - d);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            
            if (state.filters.date === 'today') matchDate = diffDays <= 1;
            if (state.filters.date === 'week') matchDate = diffDays <= 7;
            if (state.filters.date === 'month') matchDate = diffDays <= 30;
        }

        return matchText && matchCourse && matchDate;
    });
}

// === HELPER: BUSCADOR DE PLANTILLAS (BLINDADO) ===
function findBestTemplate(leadInterest) {
    if (!leadInterest) return null;
    
    // Protección contra datos corruptos
    const cleanInterest = String(leadInterest).toLowerCase().trim();

    let match = state.templates.find(t => {
        // Protección extra por si una plantilla no tiene nombre
        const tName = (t.courseName || '').toLowerCase();
        if (tName === 'manual' || tName === 'todos los cursos') return false;
        
        return (tName.includes(cleanInterest) || cleanInterest.includes(tName));
    });

    if (!match) {
        match = state.templates.find(t => t.courseName === 'Todos los Cursos');
    }

    return match;
}

// === RENDERIZADO: TABLA (CORREGIDO) ===
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
        // Bloque try-catch para que un error en una fila no rompa toda la tabla
        try {
            const tr = document.createElement('tr');
            tr.className = `hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 transition fade-in ${isCorporate(lead.email) ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`;
            
            // Lógica de Plantilla con protecciones
            const matchingTemplate = findBestTemplate(lead.curso_interes);
            const hasTemplate = !!matchingTemplate;
            const tName = matchingTemplate ? matchingTemplate.courseName : '';
            
            // ESTILO DE BOTÓN: AZUL SI YA SE ENVIÓ, GRIS SI NO
            const isSent = lead.emailSent || false;
            let btnClass = "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:bg-gray-700 dark:text-gray-400";
            if (isSent) {
                btnClass = "bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-700 border border-blue-300 shadow-sm";
            }

            const titleText = hasTemplate ? `Previsualizar plantilla de: ${tName}` : "Enviar correo genérico";

            tr.innerHTML = `
                <td class="p-4">
                    <div class="flex items-center gap-1 text-yellow-400 text-xs">
                        ${'⭐'.repeat(calculateScore(lead))}
                    </div>
                </td>
                <td class="p-4">
                    <div class="font-bold text-gray-800 dark:text-gray-200">${lead.nombre || 'Sin nombre'}</div>
                    <div class="text-xs text-gray-500">${lead.email || 'Sin email'}</div>
                </td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        ${lead.curso_interes || 'General'}
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
                        <button class="action-delete text-red-600 hover:bg-red-100 p-2 rounded-full" data-id="${lead.id}" title="Eliminar para siempre"><i class="fa-solid fa-xmark"></i></button>
                    ` : `
                        <button class="action-email w-8 h-8 rounded-full ${btnClass} transition flex items-center justify-center relative group" 
                                data-id="${lead.id}" title="${titleText}">
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
        } catch (err) {
            console.error("Error renderizando fila:", err, lead);
        }
    });

    attachDynamicListeners();
}

// === RENDERIZADO: KANBAN (CORREGIDO) ===
function renderKanban(leads) {
    const cols = {
        pendiente: document.getElementById('kanban-pending'),
        seguimiento: document.getElementById('kanban-progress'),
        contactado: document.getElementById('kanban-contacted')
    };
    
    // Si cols.pendiente es null, significa que el DOM no está listo o id incorrecto
    if(!cols.pendiente) return; 

    Object.values(cols).forEach(c => c.innerHTML = '');

    // CAMBIO IMPORTANTE: Eliminamos el filtro 'trashed' aquí.
    // Ahora renderiza todo lo que 'filterLeads' le pase, sea papelera o no.
    leads.forEach(lead => {
        const col = cols[lead.status] || cols['pendiente'];
        // Si el estado es 'trashed' y estamos en Kanban, lo mandamos a 'pendiente' visualmente o lo manejamos
        // Para simplificar, si el estado es 'trashed', no tiene columna oficial, pero filterLeads ya nos dio los datos.
        // Lo pondremos en "Pendiente" visualmente si no tiene estado válido, o creamos lógica para mostrarlo.
        
        const card = document.createElement('div');
        card.className = `bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-600 cursor-grab hover:shadow-md transition fade-in mb-3 ${isCorporate(lead.email) ? 'border-l-4 border-l-blue-500' : ''}`;
        card.setAttribute('data-id', lead.id);
        
        // Agregar distintivo si es papelera
        const trashBadge = lead.status === 'trashed' ? '<span class="text-xs bg-red-100 text-red-600 px-1 rounded font-bold">ELIMINADO</span>' : '';

        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-bold text-sm text-gray-800 dark:text-gray-100">${lead.nombre}</h4>
                <span class="text-[10px] bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-500">${timeAgo(lead.fecha?.toDate())}</span>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">${lead.email}</p>
            <div class="flex items-center justify-between mt-3">
                 <span class="text-[10px] font-bold text-brand-600 bg-brand-50 dark:bg-brand-900/30 px-2 py-1 rounded">${lead.curso_interes}</span>
                 ${trashBadge}
            </div>
        `;
        
        // Si es 'trashed', lo ponemos en la primera columna para que se vea
        if (lead.status === 'trashed') cols['pendiente'].appendChild(card);
        else col.appendChild(card);
    });

    Object.values(cols).forEach(el => {
        new Sortable(el, {
            group: 'kanban',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                // Si estamos en papelera, no permitimos mover tarjetas (opcional)
                if(state.trashMode) return;
                
                const id = evt.item.getAttribute('data-id');
                const newStatus = evt.to.getAttribute('data-status');
                if(id && newStatus) {
                    await leadsService.update(id, { status: newStatus });
                }
            }
        });
    });
}

// === SMART EMAILS (LÓGICA CON VISTA PREVIA) ===
function handleSmartEmail(leadId) {
    const lead = state.leads.find(l => l.id === leadId);
    if(!lead) return;

    const template = findBestTemplate(lead.curso_interes);

    if (template) {
        // FIXED: Reemplazar \n por \r\n para compatibilidad con Outlook
        let rawBody = template.body.replace(/{nombre}/g, (lead.nombre || '').split(' ')[0]); 
        if (template.pdfLink) {
            rawBody += `\n\nPuedes ver el temario aquí: ${template.pdfLink}`;
        }
        
        // Conversión crítica para Outlook
        const body = rawBody.replace(/\n/g, "\r\n");
        
        const mailtoLink = `mailto:${lead.email}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(body)}`;
        
        // MOSTRAR VISTA PREVIA SIEMPRE
        Swal.fire({
            title: 'Vista Previa del Correo',
            html: `
                <div class="text-left bg-gray-50 dark:bg-gray-800 p-4 rounded-lg text-sm border border-gray-200 dark:border-gray-700 mb-2">
                    <div class="mb-1"><strong class="text-gray-500">Para:</strong> ${lead.email}</div>
                    <div class="mb-2"><strong class="text-gray-500">Asunto:</strong> ${template.subject}</div>
                    <hr class="border-gray-200 dark:border-gray-700 my-2">
                    <div class="whitespace-pre-wrap text-gray-700 dark:text-gray-300 max-h-48 overflow-y-auto text-xs leading-relaxed">${rawBody}</div>
                </div>
                <p class="text-xs text-gray-400 mt-2">Al confirmar, se abrirá tu aplicación de correo (Outlook/Gmail).</p>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-paper-plane"></i> Abrir Outlook/Correo',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#2563eb'
        }).then((result) => {
            if (result.isConfirmed) {
                // FIXED: Usar enlace invisible y click() para forzar apertura en más navegadores
                const link = document.createElement('a');
                link.href = mailtoLink;
                // link.target = '_blank'; // Descomentar si aún falla, pero puede dejar pestañas en blanco
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // 2. Marcar como enviado visualmente (Sin cambiar estado a contactado)
                leadsService.update(leadId, { emailSent: true });
            }
        });

    } else {
        Swal.fire({
            title: 'Sin Plantilla',
            text: `No hay plantilla para "${lead.curso_interes}" ni una plantilla general.`,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: 'Enviar Vacío',
            cancelButtonText: 'Crear Plantilla'
        }).then((res) => {
            if(res.isConfirmed) {
                window.location.href = `mailto:${lead.email}?subject=Información Curso ${lead.curso_interes}`;
            } else if(res.dismiss === Swal.DismissReason.cancel) {
                openEmailConfigModal();
                setTimeout(() => {
                    const select = document.getElementById('tpl-course');
                    const options = Array.from(select.options).map(o => o.value);
                    if (options.includes(lead.curso_interes)) {
                         select.value = lead.curso_interes;
                    }
                    updatePreview();
                }, 300);
            }
        });
    }
}

// === GESTIÓN DEL MODAL DE PLANTILLAS ===
function openEmailConfigModal() {
    document.getElementById('email-config-modal').classList.remove('hidden');
    renderTemplatesList();
    if (!state.activeTemplateId) resetEditor();
}

function renderTemplatesList() {
    const container = document.getElementById('templates-list');
    container.innerHTML = '';
    
    if (state.templates.length === 0) {
        container.innerHTML = '<div class="p-4 text-xs text-gray-400 text-center">No hay plantillas creadas</div>';
        return;
    }

    state.templates.forEach(tpl => {
        let icon = '';
        if (tpl.courseName === 'Manual') icon = '<i class="fa-solid fa-hand-pointer text-gray-400 text-[10px]" title="Manual"></i>';
        else if (tpl.courseName === 'Todos los Cursos') icon = '<i class="fa-solid fa-globe text-blue-400 text-[10px]" title="Global"></i>';
        else if (tpl.autoSend) icon = '<i class="fa-solid fa-bolt text-yellow-400 text-[10px]" title="Auto/Preferida"></i>';

        const div = document.createElement('div');
        div.className = `email-sidebar-item p-3 rounded-lg cursor-pointer flex justify-between items-center mb-1 ${state.activeTemplateId === tpl.id ? 'active' : ''}`;
        div.innerHTML = `
            <div class="overflow-hidden">
                <p class="font-bold text-sm text-gray-700 dark:text-gray-200 truncate">${tpl.courseName}</p>
                <p class="text-[11px] text-gray-500 truncate">${tpl.subject}</p>
            </div>
            ${icon}
        `;
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
            const res = await Swal.fire({title:'¿Eliminar Plantilla?', icon:'warning', showCancelButton:true, confirmButtonColor:'#ef4444'});
            if(res.isConfirmed) {
                try {
                    await templatesService.delete(tpl.id);
                    Swal.fire({toast:true, icon:'success', title:'Eliminada', position:'top-end', showConfirmButton:false, timer:1500});
                    resetEditor();
                } catch(e) { Swal.fire('Error', 'No se pudo eliminar', 'error'); }
            }
        };
    } else {
        delBtn.classList.add('hidden');
    }
}

function resetEditor() {
    state.activeTemplateId = null;
    document.getElementById('template-editor').classList.add('hidden');
    document.getElementById('template-empty-state').classList.remove('hidden');
    document.getElementById('tpl-course').value = "";
    ['tpl-subject', 'tpl-link', 'tpl-body'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('tpl-auto').checked = false;
    updatePreview();
}

function updatePreview() {
    const subject = document.getElementById('tpl-subject').value || 'Sin asunto';
    const body = document.getElementById('tpl-body').value || 'Escribe un mensaje...';
    const link = document.getElementById('tpl-link').value;

    document.getElementById('preview-subject').textContent = subject;
    document.getElementById('preview-body').textContent = body;

    const attachmentEl = document.getElementById('preview-attachment');
    if (link && link.length > 5) {
        attachmentEl.classList.remove('hidden');
        attachmentEl.classList.add('flex');
    } else {
        attachmentEl.classList.add('hidden');
        attachmentEl.classList.remove('flex');
    }
}

async function saveCurrentTemplate() {
    const btn = document.getElementById('btn-save-template');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

    const data = {
        courseName: document.getElementById('tpl-course').value,
        subject: document.getElementById('tpl-subject').value,
        pdfLink: document.getElementById('tpl-link').value,
        body: document.getElementById('tpl-body').value,
        autoSend: document.getElementById('tpl-auto').checked
    };

    try {
        await templatesService.save(state.activeTemplateId, data);
        Swal.fire({
            toast: true, icon: 'success', title: state.activeTemplateId ? 'Actualizada' : 'Creada',
            position: 'top-end', showConfirmButton: false, timer: 2000
        });
        if (!state.activeTemplateId) resetEditor();
    } catch (error) {
        Swal.fire({ title: 'Error al Guardar', text: error.message, icon: 'error' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// === EVENT LISTENERS GENERALES ===
function initEventListeners() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const res = await authService.login(email, password);
        if (!res.success) Swal.fire('Error de Acceso', 'Verifica credenciales.', 'error');
    });
    
    document.getElementById('logout-btn').onclick = () => authService.logout();
    document.getElementById('search-input').onkeyup = (e) => { state.filters.search = e.target.value; renderApp(); };
    document.getElementById('filter-date').onchange = (e) => { state.filters.date = e.target.value; renderApp(); };
    document.getElementById('filter-course').onchange = (e) => { state.filters.course = e.target.value; renderApp(); };
    document.getElementById('btn-view-table').onclick = () => { state.view = 'table'; renderApp(); };
    document.getElementById('btn-view-kanban').onclick = () => { state.view = 'kanban'; renderApp(); };
    
    document.getElementById('btn-trash').onclick = () => { 
        state.trashMode = !state.trashMode; 
        renderApp();
    };

    document.getElementById('btn-config-email').onclick = openEmailConfigModal;
    document.getElementById('modal-backdrop-close').onclick = () => document.getElementById('email-config-modal').classList.add('hidden');
    document.getElementById('btn-close-modal').onclick = () => document.getElementById('email-config-modal').classList.add('hidden');
    document.getElementById('btn-new-template').onclick = () => loadTemplateEditor(null);
    document.getElementById('btn-save-template').onclick = saveCurrentTemplate;

    ['tpl-subject', 'tpl-body', 'tpl-link'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('keyup', updatePreview);
            el.addEventListener('change', updatePreview);
        }
    });
}

// === HELPERS & CHART ===
function updateKPIs(leads) {
    const active = leads.filter(l => l.status !== 'trashed');
    document.getElementById('kpi-total').textContent = active.length;
    document.getElementById('kpi-pending').textContent = active.filter(l => l.status === 'pendiente').length;
    document.getElementById('kpi-contacted').textContent = active.filter(l => l.status === 'contactado').length;
}

function updateChart(leads) {
    const ctx = document.getElementById('trendChart')?.getContext('2d');
    if(!ctx) return;
    const dataPoints = Array(7).fill(0);
    const labels = [];
    for(let i=6; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('es', {weekday:'short'}));
        const dayStart = new Date(d.setHours(0,0,0,0));
        const dayEnd = new Date(d.setHours(23,59,59,999));
        dataPoints[6-i] = leads.filter(l => {
            if(!l.fecha) return false;
            const ld = l.fecha.toDate();
            return ld >= dayStart && ld <= dayEnd;
        }).length;
    }
    if(state.chartInstance) state.chartInstance.destroy();
    state.chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Leads', data: dataPoints, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: {display:false} } }
    });
}

function updateViewButtons() {
    const btnTable = document.getElementById('btn-view-table');
    const btnKanban = document.getElementById('btn-view-kanban');
    if(state.view === 'table') {
        btnTable.className = "px-4 py-2 rounded-lg text-sm font-bold bg-brand-600 text-white shadow-sm transition";
        btnKanban.className = "px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 transition";
    } else {
        btnTable.className = "px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 transition";
        btnKanban.className = "px-4 py-2 rounded-lg text-sm font-bold bg-brand-600 text-white shadow-sm transition";
    }
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
        'contactado': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
        'seguimiento': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
        'trashed': 'bg-red-100 text-red-700',
        'pendiente': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
    };
    return map[s] || map['pendiente'];
}

function attachDynamicListeners() {
    document.querySelectorAll('.action-email').forEach(btn => {
        btn.onclick = () => handleSmartEmail(btn.getAttribute('data-id'));
    });
    document.querySelectorAll('.status-badge').forEach(badge => {
        badge.onclick = async () => {
            const id = badge.getAttribute('data-id');
            const current = badge.getAttribute('data-status');
            const next = current === 'contactado' ? 'pendiente' : 'contactado';
            await leadsService.update(id, { status: next });
        };
    });
    document.querySelectorAll('.action-trash').forEach(btn => 
        btn.onclick = () => leadsService.moveToTrash(btn.getAttribute('data-id')));
    document.querySelectorAll('.action-restore').forEach(btn => 
        leadsService.update(btn.getAttribute('data-id'), { status: 'pendiente' }));
    document.querySelectorAll('.action-delete').forEach(btn => {
        btn.onclick = async () => {
            const res = await Swal.fire({title:'¿Eliminar definitivamente?', text:'No se puede deshacer', icon:'warning', showCancelButton:true, confirmButtonColor:'#ef4444'});
            if(res.isConfirmed) leadsService.deletePermanent(btn.getAttribute('data-id'));
        };
    });
    document.querySelectorAll('.action-note').forEach(btn => {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-id');
            const note = btn.getAttribute('data-note');
            const { value: text } = await Swal.fire({input: 'textarea', inputValue: note, title: 'Notas Internas'});
            if (text !== undefined) await leadsService.update(id, { observaciones: text });
        };
    });
    document.querySelectorAll('.action-wa').forEach(btn => {
        btn.onclick = () => {
            const phone = btn.getAttribute('data-phone');
            const name = btn.getAttribute('data-name');
            if (!phone) return Swal.fire('Sin teléfono', '', 'info');
            const p = phone.replace(/\D/g, '').length === 9 ? '56' + phone.replace(/\D/g, '') : phone.replace(/\D/g, '');
            window.open(`https://wa.me/${p}?text=Hola ${name}, te contacto de ProgramBI...`, '_blank');
        };
    });
}
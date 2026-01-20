/* ==========================================================================
   CONFIGURAÇÃO SUPABASE
   ========================================================================== */

const SUPABASE_URL = 'https://nrqmdhnglrnmpjoueuwg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1p7pcYM_vKaCF1axOc4m-w_2J6GVFa4'

const { createClient } = supabase;
const _db = createClient(SUPABASE_URL, SUPABASE_KEY);

const uuid = () => crypto.randomUUID();
const norm = (v) => String(v || '').trim();
const toNum = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
};

// --- API REAL (SUPABASE) ---
const LocalBackend = {
    setup: async () => {
        const { data } = await _db.from('ajustes').select('*').limit(1);
        if (!data || data.length === 0) {
            const defaults = {
                tipos: ['Abastecimento', 'Manutenção', 'Pedágio', 'Estacionamento', 'Seguro', 'Imposto', 'Multa', 'Outros'],
                pagamentos: ['Pix', 'Débito', 'Crédito', 'Dinheiro'],
                locais: ['Posto Ipiranga', 'Posto Shell', 'Posto BR', 'Oficina Mecânica', 'Casa', 'Shopping', 'Detran'],
                categoriasPorTipo: {
                    'Abastecimento': ['Gasolina', 'Etanol', 'Diesel', 'GNV', 'Aditivo'],
                    'Manutenção': ['Troca de óleo', 'Filtro de óleo', 'Pneus', 'Pastilhas de freio', 'Bateria', 'Revisão', 'Peças', 'Mão de obra'],
                    'Imposto': ['IPVA', 'Licenciamento', 'DPVAT', 'Taxas'],
                    'Outros': ['Acessórios', 'Viagem', 'Documentos']
                }
            };
            await _db.from('ajustes').insert([{ config_json: defaults }]);
        }
        return { ok: true };
    },

    login: async (usuario, senha) => {
        const { data } = await _db.from('usuarios').select('*').eq('usuario', usuario).eq('senha', senha).maybeSingle();
        if (data && data.ativo) {
            const userObj = { id: data.id, usuario: data.usuario, nome: data.nome, perfil: data.perfil };
            localStorage.setItem('sess_supabase', JSON.stringify(userObj));
            return { ok: true, user: userObj };
        }
        return { ok: false, msg: 'Usuário ou senha inválidos.' };
    },

    logout: async () => { localStorage.removeItem('sess_supabase'); return { ok: true }; },

    ping: async () => {
        const raw = localStorage.getItem('sess_supabase');
        if (!raw) throw new Error('Sessão expirada');
        return { ok: true, user: JSON.parse(raw) };
    },

    listUsuarios: async () => { const { data } = await _db.from('usuarios').select('*'); return data || []; },

    saveUsuario: async (token, user) => {
        const payload = { usuario: norm(user.usuario), senha: norm(user.senha), nome: norm(user.nome), perfil: norm(user.perfil), ativo: user.ativo };
        if (user.id) { await _db.from('usuarios').update(payload).eq('id', user.id); } 
        else { await _db.from('usuarios').insert([payload]); }
        return { ok: true };
    },

    deleteUsuario: async (token, id) => { await _db.from('usuarios').delete().eq('id', id); return { ok: true }; },

    listVeiculos: async () => { const { data } = await _db.from('veiculos').select('*'); return data || []; },

    saveVeiculo: async (token, veiculo) => {
        const payload = { nome: norm(veiculo.nome), placa: norm(veiculo.placa), ano: norm(veiculo.ano), observacoes: norm(veiculo.observacoes), ativo: veiculo.ativo };
        if (veiculo.id) { await _db.from('veiculos').update(payload).eq('id', veiculo.id); }
        else { await _db.from('veiculos').insert([payload]); }
        return { ok: true };
    },

    deleteVeiculo: async (token, id) => { await _db.from('veiculos').delete().eq('id', id); return { ok: true }; },

    getAjustes: async () => {
        const { data } = await _db.from('ajustes').select('config_json').limit(1);
        return { ok: true, ...(data?.[0]?.config_json || {}) };
    },

    saveAjustes: async (token, payload) => {
        const { data } = await _db.from('ajustes').select('id').limit(1);
        if (data?.length > 0) { await _db.from('ajustes').update({ config_json: payload }).eq('id', data[0].id); }
        else { await _db.from('ajustes').insert([{ config_json: payload }]); }
        return { ok: true };
    },

    listLancamentos: async (token, filtros) => {
        const { veiculoId, anoMes, tipo } = filtros || {};
        let query = _db.from('lancamentos').select('*');
        if (veiculoId) query = query.eq('veiculo_id', veiculoId);
        if (tipo) query = query.eq('tipo', tipo);
        if (anoMes) {
            const start = `${anoMes}-01`;
            const [y, m] = anoMes.split('-');
            const end = m === '12' ? `${parseInt(y)+1}-01-01` : `${y}-${String(parseInt(m)+1).padStart(2,'0')}-01`;
            query = query.gte('data', start).lt('data', end);
        }
        const { data } = await query;
        let items = (data || []).map(it => ({ ...it, veiculoId: it.veiculo_id, formaPgto: it.forma_pgto }));
        items.sort((a, b) => (a.data > b.data ? 1 : -1));
        const lastOdo = {};
        items = items.map(it => {
            const last = lastOdo[it.veiculoId];
            const kmRodados = (last && it.odometro > last) ? it.odometro - last : 0;
            if (it.odometro) lastOdo[it.veiculoId] = it.odometro;
            let kmL = (it.tipo === 'Abastecimento' && it.litros > 0 && kmRodados > 0) ? kmRodados / it.litros : 0;
            return { ...it, kmRodados, kmPorLitro: kmL };
        });
        return items.sort((a, b) => (a.data > b.data ? -1 : 1));
    },

    addLancamento: async (token, item) => {
        const payload = { veiculo_id: item.veiculoId, data: item.data, tipo: item.tipo, categoria: item.categoria, descricao: item.descricao, valor: toNum(item.valor), litros: toNum(item.litros), odometro: toNum(item.odometro), local: item.local, forma_pgto: item.formaPgto };
        await _db.from('lancamentos').insert([payload]);
        return { ok: true };
    },

    addLancamentosBatch: async (token, items) => {
        const payload = items.map(it => ({ veiculo_id: it.veiculoId, data: it.data, tipo: it.tipo, categoria: it.categoria, descricao: it.descricao, valor: toNum(it.valor), litros: toNum(it.litros), odometro: toNum(it.odometro), local: it.local, forma_pgto: it.formaPgto }));
        await _db.from('lancamentos').insert(payload);
        return { ok: true };
    },

    updateLancamento: async (token, item) => {
        const payload = { veiculo_id: item.veiculoId, data: item.data, tipo: item.tipo, categoria: item.categoria, descricao: item.descricao, valor: toNum(item.valor), litros: toNum(item.litros), odometro: toNum(item.odometro), local: item.local, forma_pgto: item.formaPgto };
        await _db.from('lancamentos').update(payload).eq('id', item.id);
        return { ok: true };
    },

    deleteLancamento: async (token, id) => { await _db.from('lancamentos').delete().eq('id', id); return { ok: true }; },

    getDashboard: async (token, filtros) => {
        const items = await LocalBackend.listLancamentos(token, filtros);
        let total = 0, totalKm = 0, totalLitros = 0, gastoComb = 0;
        const porTipo = {}, porCategoria = {};
        items.forEach(it => {
            total += it.valor;
            porTipo[it.tipo] = (porTipo[it.tipo] || 0) + it.valor;
            porCategoria[it.categoria || 'Outros'] = (porCategoria[it.categoria || 'Outros'] || 0) + it.valor;
            if (it.tipo === 'Abastecimento') { totalLitros += it.litros; gastoComb += it.valor; totalKm += it.kmRodados || 0; }
        });
        return { ok: true, total, porTipo, porCategoria, totalKm, totalLitros, custoPorKm: totalKm > 0 ? gastoComb / totalKm : 0, consumoMedio: (totalLitros > 0 && totalKm > 0) ? totalKm / totalLitros : 0 };
    }
};

/* ==========================================================================
   FRONTEND LOGIC
   ========================================================================== */

const $ = (id) => document.getElementById(id);

const state = {
    token: 'sb-token',
    user: null,
    veiculos: [],
    veiculoId: '',
    anoMes: '',
    route: 'dashboard',
    lancamentos: [],
    ajustes: { tipos: [], pagamentos: [], locais: [], categoriasPorTipo: {} },
    relatorioFilter: 'Todos'
};

const DEFAULTS = {
    tipos: ['Abastecimento', 'Manutenção', 'Pedágio', 'Estacionamento', 'Seguro', 'Imposto', 'Multa', 'Outros'],
    pagamentos: ['Pix', 'Débito', 'Crédito', 'Dinheiro'],
    locais: ['Posto Ipiranga', 'Posto Shell', 'Posto BR', 'Oficina Mecânica', 'Casa', 'Shopping', 'Detran'],
    categoriasPorTipo: {
        'Abastecimento': ['Gasolina', 'Etanol', 'Diesel', 'GNV', 'Aditivo'],
        'Manutenção': ['Troca de óleo', 'Filtro de óleo', 'Pneus', 'Pastilhas de freio', 'Bateria', 'Revisão', 'Peças', 'Mão de obra'],
        'Imposto': ['IPVA', 'Licenciamento', 'DPVAT', 'Taxas'],
        'Outros': ['Acessórios', 'Viagem', 'Documentos']
    }
};

window.__servicos = [];

function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2400);
}

function money(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function num(v, d = 2) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function ymNow() { const dt = new Date(); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; }
function uniqueCleanLines(text) { return [...new Set(String(text || '').split('\n').map(s => s.trim()).filter(Boolean))]; }
function escapeHtml(str) { return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"}[m])); }

async function api(fn, args) {
    try { return await LocalBackend[fn](...args); } catch (e) { toast('Erro: ' + e.message); throw e; }
}

async function loadAjustes() {
    const res = await api('getAjustes', []);
    state.ajustes = {
        tipos: res.tipos?.length ? res.tipos : DEFAULTS.tipos,
        pagamentos: res.pagamentos?.length ? res.pagamentos : DEFAULTS.pagamentos,
        locais: res.locais?.length ? res.locais : DEFAULTS.locais,
        categoriasPorTipo: Object.keys(res.categoriasPorTipo || {}).length ? res.categoriasPorTipo : DEFAULTS.categoriasPorTipo
    };
    buildTipoSelect();
}

function buildSelect(id, items, val) {
    const sel = $(id); if (!sel) return; sel.innerHTML = items.map(it => `<option value="${it}">${it}</option>`).join('');
    if (val) sel.value = val;
}

function buildTipoSelect() { buildSelect('fTipo', state.ajustes.tipos); }
function updateCategoriaSelect() { const t = $('fTipo').value; buildSelect('fCategoria', state.ajustes.categoriasPorTipo[t] || []); }
function updateLocalSelect() { buildSelect('fLocal', state.ajustes.locais); }
function updatePgtoSelect() { buildSelect('fPgto', state.ajustes.pagamentos); }

function toggleModoManutencao() {
    const manut = ($('fTipo').value === 'Manutenção');
    $('wrapLitros').style.display = ($('fTipo').value === 'Abastecimento') ? 'grid' : 'none';
    $('wrapCategoriaValor').classList.toggle('hidden', manut);
    $('wrapServicos').classList.toggle('hidden', !manut);
    updateCategoriaSelect();
    if (manut && !window.__servicos.length) { window.__servicos = [{ categoria: 'Troca de óleo', valor: '' }]; renderServicos(); }
}

function renderServicos() {
    const tbody = $('servicosBody'); if (!tbody) return;
    const cats = state.ajustes.categoriasPorTipo['Manutenção'] || [];
    tbody.innerHTML = window.__servicos.map((it, i) => `
        <tr>
            <td><select onchange="window.__servicos[${i}].categoria=this.value">${cats.map(c => `<option value="${c}" ${c===it.categoria?'selected':''}>${c}</option>`).join('')}</select></td>
            <td><input type="number" value="${it.valor}" oninput="window.__servicos[${i}].valor=this.value; updateTotalServicos()"></td>
            <td><button class="btn danger" onclick="window.__servicos.splice(${i},1); renderServicos()">X</button></td>
        </tr>`).join('');
    updateTotalServicos();
}
function updateTotalServicos() { $('servicosTotal').textContent = money(window.__servicos.reduce((s, it) => s + Number(it.valor || 0), 0)); }

async function doLogin() {
    const res = await api('login', [$('loginUser').value, $('loginPass').value]);
    if (res.ok) { state.user = res.user; await bootApp(); } else toast(res.msg);
}

function updateMenuVisibility() {
    const isClient = state.user?.perfil === 'CLIENTE';
    document.querySelectorAll('.menu-item').forEach(btn => {
        if (['lancamentos','abastecimentos','manutencoes','veiculos','ajustes','usuarios'].includes(btn.dataset.route) && isClient) btn.classList.add('hidden');
    });
    if (isClient) $('btnNew').classList.add('hidden');
}

async function bootApp() {
    await api('setup', []);
    $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden');
    $('userMini').textContent = state.user.nome;
    state.anoMes = ymNow(); $('monthSelect').value = state.anoMes;
    updateMenuVisibility();
    await loadAjustes(); await loadVeiculos();
    await routeTo('dashboard');
}

async function loadVeiculos() {
    const list = await api('listVeiculos', []);
    state.veiculos = list.filter(v => v.ativo);
    $('vehicleSelect').innerHTML = state.veiculos.map(v => `<option value="${v.id}">${v.nome}</option>`).join('');
    state.veiculoId = $('vehicleSelect').value;
}

async function routeTo(route) {
    state.route = route;
    document.querySelectorAll('.menu-item').forEach(b => b.classList.toggle('active', b.dataset.route === route));
    if (route === 'dashboard') await renderDashboard();
    else if (route === 'relatorios') await renderRelatorios();
    else if (route === 'veiculos') await renderVeiculos();
    else if (route === 'ajustes') await renderAjustes();
    else if (route === 'usuarios') await renderUsuarios();
    else await renderLancamentos(route === 'abastecimentos' ? 'Abastecimento' : route === 'manutencoes' ? 'Manutenção' : '');
}

async function renderDashboard() {
    const dash = await api('getDashboard', [state.token, { veiculoId: state.veiculoId, anoMes: state.anoMes }]);
    $('pageContent').innerHTML = `
        <div class="cards">
            <div class="card kpi"><div class="k">Gasto Mês</div><div class="v">${money(dash.total)}</div></div>
            <div class="card kpi"><div class="k">Km Rodados</div><div class="v">${num(dash.totalKm, 0)} km</div></div>
            <div class="card kpi"><div class="k">Média km/L</div><div class="v">${num(dash.consumoMedio)}</div></div>
        </div>`;
}

async function renderRelatorios() {
    const filter = state.relatorioFilter || 'Todos';
    const items = await api('listLancamentos', [state.token, { veiculoId: state.veiculoId, anoMes: state.anoMes, tipo: filter==='Todos'?'':filter }]);
    const total = items.reduce((s, it) => s + it.valor, 0);
    $('pageContent').innerHTML = `
        <div class="card panel">
            <select id="relFilterSelect" onchange="state.relatorioFilter=this.value; renderRelatorios()"><option value="Todos">Todos</option><option value="Abastecimento">Abastecimento</option><option value="Manutenção">Manutenção</option></select>
            <button class="btn primary" onclick="downloadPDF()">PDF</button>
        </div>
        <div id="print-area">
            <div class="card panel"><h3>Total: ${money(total)}</h3></div>
            <table class="table">
                <thead><tr><th>Data</th><th>Tipo</th><th>Valor</th></tr></thead>
                <tbody>${items.map(it => `<tr><td>${it.data}</td><td>${it.tipo}</td><td>${money(it.valor)}</td></tr>`).join('')}</tbody>
            </table>
        </div>`;
}

function downloadPDF() {
    html2pdf().from($('print-area')).save(`relatorio-${state.anoMes}.pdf`);
}

// ... Restante das funções auxiliares de UI ...
async function renderVeiculos() {
    const list = await api('listVeiculos', []);
    $('pageContent').innerHTML = `
        <div class="card panel">
            <input id="vNome" placeholder="Nome do Veículo">
            <button class="btn primary" onclick="saveVeic()">Salvar</button>
        </div>
        <table class="table">${list.map(v => `<tr><td>${v.nome}</td><td><button onclick="delVeic('${v.id}')">X</button></td></tr>`).join('')}</table>`;
}
async function saveVeic() { await api('saveVeiculo', [state.token, { nome: $('vNome').value, ativo: true }]); renderVeiculos(); }
async function delVeic(id) { if(confirm('Excluir?')) { await api('deleteVeiculo', [id]); renderVeiculos(); } }

async function renderUsuarios() {
    const list = await api('listUsuarios', []);
    $('pageContent').innerHTML = `
        <div class="card panel">
            <input id="uUser" placeholder="Usuário">
            <input id="uPass" placeholder="Senha">
            <select id="uPerfil"><option value="ADMIN">ADMIN</option><option value="CLIENTE">CLIENTE</option></select>
            <button class="btn primary" onclick="saveUser()">Criar</button>
        </div>
        <table class="table">${list.map(u => `<tr><td>${u.usuario}</td><td>${u.perfil}</td><td><button onclick="delUser('${u.id}')">X</button></td></tr>`).join('')}</table>`;
}
async function saveUser() { await api('saveUsuario', [state.token, { usuario:$('uUser').value, senha:$('uPass').value, perfil:$('uPerfil').value, ativo:true }]); renderUsuarios(); }
async function delUser(id) { if(confirm('Excluir?')) { await api('deleteUsuario', [state.token, id]); renderUsuarios(); } }

async function renderAjustes() {
    $('pageContent').innerHTML = `
        <div class="card panel">
            <h3>Categorias</h3>
            <textarea id="ajCats" style="height:200px">${state.ajustes.tipos.join('\n')}</textarea>
            <button class="btn primary" onclick="saveAj()">Salvar</button>
        </div>`;
}
async function saveAj() { 
    state.ajustes.tipos = uniqueCleanLines($('ajCats').value);
    await api('saveAjustes', [state.token, state.ajustes]);
    toast('Salvo');
}

async function renderLancamentos(tipo) {
    const list = await api('listLancamentos', [state.token, { veiculoId: state.veiculoId, anoMes: state.anoMes, tipo }]);
    $('pageContent').innerHTML = `
        <table class="table">
            <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Ação</th></tr></thead>
            <tbody>${list.map(it => `<tr><td>${it.data}</td><td>${it.descricao || it.categoria}</td><td>${money(it.valor)}</td><td><button onclick="delLanc('${it.id}')">X</button></td></tr>`).join('')}</tbody>
        </table>`;
}
async function delLanc(id) { if(confirm('Excluir?')) { await api('deleteLancamento', [id]); routeTo(state.route); } }

function openModal() {
    $('modal').classList.remove('hidden');
    $('fData').value = new Date().toISOString().split('T')[0];
    buildTipoSelect(); updateLocalSelect(); updatePgtoSelect(); updateCategoriaSelect();
}
async function saveLanc() {
    const item = { veiculoId: state.veiculoId, data: $('fData').value, tipo: $('fTipo').value, categoria: $('fCategoria').value, valor: $('fValor').value, odometro: $('fOdo').value, local: $('fLocal').value, formaPgto: $('fPgto').value, descricao: $('fDesc').value };
    if (item.tipo === 'Manutenção') {
        const batch = window.__servicos.map(s => ({ ...item, categoria: s.categoria, valor: s.valor }));
        await api('addLancamentosBatch', [state.token, batch]);
    } else {
        item.litros = $('fLitros').value;
        await api('addLancamento', [state.token, item]);
    }
    $('modal').classList.add('hidden'); routeTo(state.route);
}

document.addEventListener('DOMContentLoaded', () => {
    $('btnLogin').onclick = doLogin;
    $('btnNew').onclick = openModal;
    $('btnCloseModal').onclick = () => $('modal').classList.add('hidden');
    $('btnCancel').onclick = () => $('modal').classList.add('hidden');
    $('btnSave').onclick = saveLanc;
    $('fTipo').onchange = toggleModoManutencao;
    $('btnAddServico').onclick = () => { window.__servicos.push({categoria:'Troca de óleo', valor:''}); renderServicos(); };
    $('vehicleSelect').onchange = (e) => { state.veiculoId = e.target.value; routeTo(state.route); };
    $('monthSelect').onchange = (e) => { state.anoMes = e.target.value; routeTo(state.route); };
    $('btnToggleMenu').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
    document.querySelectorAll('.menu-item').forEach(btn => btn.onclick = () => routeTo(btn.dataset.route));
    
    const raw = localStorage.getItem('sess_supabase');
    if (raw) { state.user = JSON.parse(raw); bootApp(); }
});
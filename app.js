/* ==========================================================================
   CONFIGURAÇÃO SUPABASE
   Substitua ABAIXO pelas suas chaves do Supabase
   ========================================================================== */

const SUPABASE_URL = 'https://nrqmdhnglrnmpjoueuwg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1p7pcYM_vKaCF1axOc4m-w_2J6GVFa4';

// Inicializa o cliente Supabase
const { createClient } = supabase;
const _db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Funções Auxiliares
const uuid = () => crypto.randomUUID(); // Mantido para compatibilidade interna se precisar
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
        // No Supabase as tabelas já foram criadas via SQL.
        // Apenas verificamos se a tabela ajustes tem algo, se não tiver, cria padrão.
        const { data, error } = await _db.from('ajustes').select('*').limit(1);
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
        // Login simples consultando tabela personalizada
        const { data, error } = await _db
            .from('usuarios')
            .select('*')
            .eq('usuario', usuario)
            .eq('senha', senha)
            .maybeSingle();

        if (data && data.ativo) {
            const token = 'session_' + Date.now(); // Simulação de token
            const userObj = { id: data.id, usuario: data.usuario, nome: data.nome, perfil: data.perfil };
            localStorage.setItem('sess_supabase', JSON.stringify(userObj));
            return { ok: true, token, user: userObj };
        }
        return { ok: false, msg: 'Usuário ou senha inválidos.' };
    },

    logout: async (token) => {
        localStorage.removeItem('sess_supabase');
        return { ok: true };
    },

    ping: async (token) => {
        const raw = localStorage.getItem('sess_supabase');
        if (!raw) throw new Error('Sessão expirada');
        return { ok: true, user: JSON.parse(raw) };
    },

    // --- USUARIOS CRUD ---
    listUsuarios: async () => {
        const { data } = await _db.from('usuarios').select('*');
        return data || [];
    },

    saveUsuario: async (token, user) => {
        const payload = {
            usuario: norm(user.usuario),
            senha: norm(user.senha),
            nome: norm(user.nome),
            perfil: norm(user.perfil),
            ativo: user.ativo
        };
        
        if (user.id) {
            await _db.from('usuarios').update(payload).eq('id', user.id);
            return { ok: true };
        } else {
            const { data, error } = await _db.from('usuarios').insert([payload]).select();
            if(error) throw new Error(error.message);
            return { ok: true, id: data[0].id };
        }
    },

    deleteUsuario: async (token, id) => {
        await _db.from('usuarios').delete().eq('id', id);
        return { ok: true };
    },

    // --- VEICULOS ---
    listVeiculos: async () => {
        const { data } = await _db.from('veiculos').select('*');
        return data || [];
    },

    saveVeiculo: async (token, veiculo) => {
        const payload = {
            nome: norm(veiculo.nome),
            placa: norm(veiculo.placa),
            ano: norm(veiculo.ano),
            observacoes: norm(veiculo.observacoes),
            ativo: veiculo.ativo
        };

        if (veiculo.id) {
            await _db.from('veiculos').update(payload).eq('id', veiculo.id);
            return { ok: true };
        } else {
            const { data } = await _db.from('veiculos').insert([payload]).select();
            return { ok: true, id: data[0].id };
        }
    },

    deleteVeiculo: async (token, id) => {
        await _db.from('veiculos').delete().eq('id', id);
        return { ok: true };
    },

    // --- AJUSTES ---
    getAjustes: async () => {
        const { data } = await _db.from('ajustes').select('config_json').limit(1);
        if (data && data.length > 0) return { ok: true, ...data[0].config_json };
        return { ok: true }; // Retorna vazio se falhar, frontend usa defaults
    },

    saveAjustes: async (token, payload) => {
        // Pega o ID do primeiro registro de ajuste
        const { data } = await _db.from('ajustes').select('id').limit(1);
        if (data && data.length > 0) {
            await _db.from('ajustes').update({ config_json: payload }).eq('id', data[0].id);
        } else {
            await _db.from('ajustes').insert([{ config_json: payload }]);
        }
        return { ok: true };
    },

    // --- LANÇAMENTOS (O CORAÇÃO DO SISTEMA) ---
    listLancamentos: async (token, filtros) => {
        const { veiculoId, anoMes, tipo } = filtros || {};
        
        let query = _db.from('lancamentos').select('*');

        if (veiculoId) query = query.eq('veiculo_id', veiculoId);
        if (tipo) query = query.eq('tipo', tipo);
        
        // Filtro de data (Mês)
        if (anoMes) {
            const [ano, mes] = anoMes.split('-');
            // Primeiro dia do mês
            const start = `${ano}-${mes}-01`;
            // Último dia (simplificado para virada do mês seguinte)
            let nextM = parseInt(mes) + 1;
            let nextY = parseInt(ano);
            if(nextM > 12) { nextM = 1; nextY++; }
            const end = `${nextY}-${String(nextM).padStart(2,'0')}-01`;
            
            query = query.gte('data', start).lt('data', end);
        }

        const { data, error } = await query;
        if (error) { console.error(error); return []; }

        let items = data || [];

        // Ordenação manual para garantir (embora pudesse ser no SQL)
        items.sort((a, b) => (a.data > b.data ? 1 : a.data < b.data ? -1 : (a.odometro - b.odometro)));

        // Calcular Km Rodados (Lógica mantida no JS para simplicidade)
        const lastOdoByVehicle = {}; 
        
        // Precisa processar em ordem cronológica
        items = items.map(it => {
            // Mapeando nomes do banco (snake_case) para o frontend (camelCase) se necessário, 
            // mas tentei manter compatível no SQL. O Supabase retorna colunas como criadas.
            // Ajuste: veiculo_id -> veiculoId
            const mapped = {
                ...it,
                veiculoId: it.veiculo_id,
                formaPgto: it.forma_pgto
            };

            const key = mapped.veiculoId;
            const last = lastOdoByVehicle[key];
            const kmRodados = (last && mapped.odometro && mapped.odometro > last) ? (mapped.odometro - last) : 0;
            
            if (mapped.odometro) lastOdoByVehicle[key] = mapped.odometro;

            let kmPorLitro = 0;
            if (mapped.tipo === 'Abastecimento' && mapped.litros > 0 && kmRodados > 0) {
                kmPorLitro = kmRodados / mapped.litros;
            }
            return { ...mapped, kmRodados, kmPorLitro };
        });

        // Reordena decrescente para visualização (mais recente em cima)
        return items.sort((a, b) => (a.data > b.data ? -1 : 1));
    },

    addLancamento: async (token, item) => {
        const payload = {
            veiculo_id: item.veiculoId,
            data: item.data,
            tipo: item.tipo,
            categoria: item.categoria,
            descricao: item.descricao,
            valor: toNum(item.valor),
            litros: toNum(item.litros),
            odometro: toNum(item.odometro),
            local: item.local,
            forma_pgto: item.formaPgto
        };
        const { data, error } = await _db.from('lancamentos').insert([payload]).select();
        if(error) throw new Error(error.message);
        return { ok: true, id: data[0].id };
    },

    addLancamentosBatch: async (token, items) => {
        const payload = items.map(item => ({
            veiculo_id: item.veiculoId,
            data: item.data,
            tipo: item.tipo,
            categoria: item.categoria,
            descricao: item.descricao,
            valor: toNum(item.valor),
            litros: toNum(item.litros),
            odometro: toNum(item.odometro),
            local: item.local,
            forma_pgto: item.formaPgto
        }));
        const { error } = await _db.from('lancamentos').insert(payload);
        if(error) throw new Error(error.message);
        return { ok: true };
    },

    updateLancamento: async (token, item) => {
        const payload = {
            veiculo_id: item.veiculoId,
            data: item.data,
            tipo: item.tipo,
            categoria: item.categoria,
            descricao: item.descricao,
            valor: toNum(item.valor),
            litros: toNum(item.litros),
            odometro: toNum(item.odometro),
            local: item.local,
            forma_pgto: item.formaPgto
        };
        await _db.from('lancamentos').update(payload).eq('id', item.id);
        return { ok: true };
    },

    deleteLancamento: async (token, id) => {
        await _db.from('lancamentos').delete().eq('id', id);
        return { ok: true };
    },

    getDashboard: async (token, filtros) => {
        // Reutiliza a lógica de listagem para garantir cálculos consistentes
        const items = await LocalBackend.listLancamentos(token, filtros);
        
        let total = 0;
        let totalKm = 0;
        let totalLitros = 0;
        let gastoComb = 0;
        const porTipo = {};
        const porCategoria = {};

        items.forEach(it => {
            total += it.valor;
            porTipo[it.tipo] = (porTipo[it.tipo] || 0) + it.valor;
            const cat = it.categoria || '(Sem categoria)';
            porCategoria[cat] = (porCategoria[cat] || 0) + it.valor;

            if (it.tipo === 'Abastecimento') {
                totalLitros += it.litros;
                gastoComb += it.valor;
                // Como recalculamos na listagem, usamos o valor processado
                totalKm += it.kmRodados || 0;
            }
        });

        const custoPorKm = totalKm > 0 ? (gastoComb / totalKm) : 0;
        const consumoMedio = totalLitros > 0 && totalKm > 0 ? (totalKm / totalLitros) : 0;

        return { ok: true, total, porTipo, porCategoria, totalKm, totalLitros, custoPorKm, consumoMedio };
    }
};

/* ==========================================================================
   PARTE 2: FRONTEND LOGIC (MANTIDA IGUAL, SÓ API ALTERADA)
   ========================================================================== */

const $ = (id) => document.getElementById(id);

const state = {
    token: localStorage.getItem('veh_token') || '',
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
window.__toastTimer = null;

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => t.style.display = 'none', 2400);
}

function money(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function num(v, d = 2) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function ymNow() { const dt = new Date(); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; }
function uniqueCleanLines(text) {
    const arr = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const seen = new Set(); const out = [];
    arr.forEach(v => { const k = v.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(v); } });
    return out;
}

// === BRIDGE ===
async function api(fn, args) {
    // Agora chama o objeto que conecta no Supabase
    if (LocalBackend[fn]) {
        try {
            return await LocalBackend[fn](...args);
        } catch (err) {
            console.error(err);
            toast('Erro de Rede/Banco: ' + err.message);
            throw err;
        }
    }
    throw new Error('Função API não encontrada: ' + fn);
}

// ======================================================
// LÓGICA DE UI (EXATAMENTE A MESMA DE ANTES)
// ======================================================

async function loadAjustes() {
    try {
        const res = await api('getAjustes', []);
        if (res && res.ok) {
            state.ajustes = {
                tipos: (res.tipos && res.tipos.length) ? res.tipos : DEFAULTS.tipos,
                pagamentos: (res.pagamentos && res.pagamentos.length) ? res.pagamentos : DEFAULTS.pagamentos,
                locais: (res.locais && res.locais.length) ? res.locais : DEFAULTS.locais,
                categoriasPorTipo: (res.categoriasPorTipo && Object.keys(res.categoriasPorTipo).length) ? res.categoriasPorTipo : DEFAULTS.categoriasPorTipo
            };
        } else { state.ajustes = JSON.parse(JSON.stringify(DEFAULTS)); }
    } catch (e) { state.ajustes = JSON.parse(JSON.stringify(DEFAULTS)); }
    if (!state.ajustes.tipos.includes('Abastecimento')) state.ajustes.tipos.unshift('Abastecimento');
    if (!state.ajustes.tipos.includes('Manutenção')) state.ajustes.tipos.unshift('Manutenção');
    buildTipoSelect();
}

function buildSelect(id, items, selectedValue) {
    const sel = $(id); if (!sel) return; sel.innerHTML = '';
    (items || []).forEach(item => { const opt = document.createElement('option'); opt.value = item; opt.textContent = item; sel.appendChild(opt); });
    if (selectedValue && items.includes(selectedValue)) sel.value = selectedValue; else if (items.length > 0) sel.value = items[0];
}

function buildTipoSelect() { buildSelect('fTipo', state.ajustes.tipos); }
function updateCategoriaSelect() { const tipo = $('fTipo').value; const mapa = state.ajustes.categoriasPorTipo || {}; const lista = mapa[tipo] || mapa['Outros'] || []; buildSelect('fCategoria', lista); }
function updateLocalSelect() { buildSelect('fLocal', state.ajustes.locais); }
function updatePgtoSelect() { buildSelect('fPgto', state.ajustes.pagamentos); }
function defaultCategoriaByTipo(tipo) { if (tipo === 'Abastecimento') return 'Gasolina'; if (tipo === 'Manutenção') return 'Troca de óleo'; if (tipo === 'Imposto') return 'IPVA'; return ''; }

function isManutencao() { return ($('fTipo') && $('fTipo').value === 'Manutenção'); }
function toggleModoManutencao() {
    const manut = isManutencao();
    $('wrapLitros').style.display = ($('fTipo').value === 'Abastecimento') ? 'grid' : 'none';
    $('wrapCategoriaValor').classList.toggle('hidden', manut);
    $('wrapServicos').classList.toggle('hidden', !manut);
    updateCategoriaSelect();
    if (manut) { if (!Array.isArray(window.__servicos) || window.__servicos.length === 0) window.__servicos = [{ categoria: defaultCategoriaByTipo('Manutenção'), valor: '' }]; renderServicos(); } else { window.__servicos = []; }
}
function renderServicos() {
    const tbody = $('servicosBody'); if (!tbody) return;
    const tipo = 'Manutenção'; const mapa = state.ajustes.categoriasPorTipo || {};
    const listaCats = mapa[tipo] || mapa['Outros'] || [];
    const optionsHtml = listaCats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    const lista = window.__servicos || [];
    const rows = lista.map((it, i) => {
        const cat = it.categoria || ''; const val = it.valor ?? '';
        const selectWithVal = `<select class="row-select" onchange="updateServico(${i}, 'categoria', this.value)">${optionsHtml}</select>`;
        const finalSelect = selectWithVal.replace(`value="${escapeHtml(cat)}">`, `value="${escapeHtml(cat)}" selected>`);
        return `<tr><td>${finalSelect}</td><td><input type="number" step="0.01" value="${escapeHtml(val)}" placeholder="0,00" oninput="updateServico(${i}, 'valor', this.value)"></td><td><button class="btn danger" type="button" onclick="removeServico(${i})">Remover</button></td></tr>`;
    }).join('');
    tbody.innerHTML = rows || `<tr><td colspan="3" style="color:var(--muted)">Adicione um serviço.</td></tr>`;
    const selects = tbody.querySelectorAll('select');
    lista.forEach((it, idx) => { if (selects[idx]) selects[idx].value = it.categoria || listaCats[0]; });
    updateTotalServicos();
}
window.updateServico = function (i, field, value) { const lista = window.__servicos || []; if (!lista[i]) return; lista[i][field] = value; window.__servicos = lista; updateTotalServicos(); }
window.removeServico = function (i) { const lista = window.__servicos || []; lista.splice(i, 1); window.__servicos = lista.length ? lista : [{ categoria: defaultCategoriaByTipo('Manutenção'), valor: '' }]; renderServicos(); }
function addServico() { const lista = window.__servicos || []; lista.push({ categoria: defaultCategoriaByTipo('Manutenção'), valor: '' }); window.__servicos = lista; renderServicos(); }
function updateTotalServicos() { const total = (window.__servicos || []).reduce((s, it) => s + Number(it.valor || 0), 0); const el = $('servicosTotal'); if (el) el.textContent = money(total); }

async function tryAutoLogin() {
    if (!state.token) return false;
    try { const res = await api('ping', [state.token]); if (res && res.ok) { state.user = res.user; return true; } return false; } catch (e) { return false; }
}
async function doLogin() {
    const usuario = $('loginUser').value.trim(); const senha = $('loginPass').value.trim(); if (!usuario || !senha) return toast('Informe usuário e senha.');
    try { const res = await api('login', [usuario, senha]); if (!res.ok) return toast(res.msg || 'Falha no login.'); state.token = res.token; state.user = res.user; localStorage.setItem('veh_token', state.token); await bootApp(); } catch (e) { toast(e.message || 'Erro no login.'); }
}
async function doLogout() { try { await api('logout', [state.token]); } catch (e) { } state.token = ''; state.user = null; localStorage.removeItem('veh_token'); $('appView').classList.add('hidden'); $('loginView').classList.remove('hidden'); toast('Saiu.'); }
function updateMenuVisibility() {
    const isClient = state.user?.perfil === 'CLIENTE'; const blockedRoutes = ['lancamentos', 'abastecimentos', 'manutencoes', 'veiculos', 'ajustes', 'usuarios'];
    document.querySelectorAll('.menu-item').forEach(btn => { const route = btn.dataset.route; if (blockedRoutes.includes(route) && isClient) btn.classList.add('hidden'); else btn.classList.remove('hidden'); });
    const btnNew = $('btnNew'); if (btnNew) { if (isClient) btnNew.classList.add('hidden'); else btnNew.classList.remove('hidden'); }
}

async function bootApp() {
    await api('setup', []); $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden');
    $('userMini').textContent = `${state.user?.nome || state.user?.usuario || ''} • ${state.user?.perfil || ''}`;
    state.anoMes = ymNow(); $('monthSelect').value = state.anoMes; updateMenuVisibility();
    await loadAjustes(); await loadVeiculos();
    if (!state.veiculoId && state.veiculos.length) { const first = state.veiculos.find(v => v.ativo) || state.veiculos[0]; state.veiculoId = first?.id || ''; }
    $('vehicleSelect').value = state.veiculoId; await routeTo('dashboard');
}
async function loadVeiculos() {
    const list = await api('listVeiculos', []); state.veiculos = (list || []).filter(v => v.ativo);
    const sel = $('vehicleSelect'); sel.innerHTML = '';
    if (!state.veiculos.length) { sel.innerHTML = `<option value="">(Cadastre um veículo)</option>`; state.veiculoId = ''; return; }
    state.veiculos.forEach(v => { const opt = document.createElement('option'); opt.value = v.id; opt.textContent = `${v.nome || 'Veículo'}${v.placa ? ' • ' + v.placa : ''}`; sel.appendChild(opt); });
    if (!state.veiculoId) state.veiculoId = state.veiculos[0].id;
}

async function routeTo(route) {
    if (state.user?.perfil === 'CLIENTE') { const blockedRoutes = ['lancamentos', 'abastecimentos', 'manutencoes', 'veiculos', 'ajustes', 'usuarios']; if (blockedRoutes.includes(route)) route = 'dashboard'; }
    state.route = route; document.querySelectorAll('.menu-item').forEach(b => { b.classList.toggle('active', b.dataset.route === route); });
    const titles = {
        dashboard: ['Dashboard', 'Resumo do mês selecionado'], lancamentos: ['Lançamentos', 'Todos os gastos do mês'], abastecimentos: ['Abastecimentos', 'Consumo e custos de combustível'], manutencoes: ['Manutenções', 'Serviços, peças e revisões'],
        relatorios: ['Relatórios', 'Resumo e histórico de gastos'], veiculos: ['Veículos', 'Cadastro e gestão de veículos'], ajustes: ['Ajustes', 'Edite Tipos, Categorias, Pagamentos e Locais'], usuarios: ['Usuários', 'Gerenciar acesso ao sistema']
    };
    const [t, s] = titles[route] || ['Controle', '']; $('pageTitle').textContent = t; $('pageSub').textContent = s;
    const content = $('pageContent'); content.innerHTML = `<div class="card panel">Carregando...</div>`;
    if (route === 'dashboard') return renderDashboard();
    if (route === 'lancamentos') return renderLancamentos({ tipo: '' });
    if (route === 'abastecimentos') return renderLancamentos({ tipo: 'Abastecimento' });
    if (route === 'manutencoes') return renderLancamentos({ tipo: 'Manutenção' });
    if (route === 'relatorios') return renderRelatorios();
    if (route === 'veiculos') return renderVeiculos();
    if (route === 'ajustes') return renderAjustes();
    if (route === 'usuarios') return renderUsuarios();
    content.innerHTML = `<div class="card panel">Tela em construção.</div>`;
}

async function renderRelatorios() {
    const content = $('pageContent');
    if (!state.veiculoId) return content.innerHTML = `<div class="card panel">Cadastre um veículo primeiro.</div>`;
    const filter = state.relatorioFilter || 'Todos';
    const tipoFilter = filter === 'Todos' ? '' : filter;
    const items = await api('listLancamentos', [state.token, { veiculoId: state.veiculoId, anoMes: state.anoMes, tipo: tipoFilter }]);
    let totalValor = 0, totalLitros = 0, totalKm = 0;
    const rows = items.map(it => {
        totalValor += it.valor;
        if(it.tipo === 'Abastecimento') { totalLitros += (it.litros || 0); totalKm += (it.kmRodados || 0); }
        const dateStr = it.data.split('-').reverse().join('/');
        const details = it.tipo === 'Abastecimento' ? `${num(it.litros)} L • ${it.categoria}` : it.categoria;
        return `<tr><td style="font-size:13px">${dateStr}</td><td><div style="font-weight:bold;font-size:13px">${escapeHtml(it.tipo)}</div><div style="font-size:12px;color:var(--muted)">${escapeHtml(it.descricao || '')}</div></td><td style="font-size:13px">${escapeHtml(details)}</td><td style="font-weight:bold;font-size:13px">${money(it.valor)}</td></tr>`;
    }).join('');

    content.innerHTML = `<div class="card panel" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;"><div style="font-weight:900">Filtro do Extrato</div><div style="display:flex;gap:10px;"><select id="relFilterSelect" style="padding:8px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;"><option value="Todos" ${filter==='Todos'?'selected':''}>Todos</option><option value="Abastecimento" ${filter==='Abastecimento'?'selected':''}>Abastecimentos</option><option value="Manutenção" ${filter==='Manutenção'?'selected':''}>Manutenções</option></select><button class="btn primary" onclick="downloadPDF()">📄 PDF</button></div></div><div id="print-area"><div class="card panel" style="border:1px solid #333;"><div class="panel-title">Resumo (${filter}) - ${state.anoMes}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><div><div style="font-size:12px;color:var(--muted)">Total Gasto</div><div style="font-size:20px;font-weight:bold;color:var(--primary)">${money(totalValor)}</div></div>${filter !== 'Manutenção' ? `<div><div style="font-size:12px;color:var(--muted)">Total Litros</div><div style="font-size:20px;font-weight:bold">${num(totalLitros)} L</div></div>` : ''}</div></div><div class="card panel"><div class="panel-title">Histórico de Lançamentos</div><table class="table" style="margin-top:10px"><thead><tr style="border-bottom:1px solid #333;text-align:left"><th style="padding-bottom:8px">Data</th><th style="padding-bottom:8px">Tipo / Descrição</th><th style="padding-bottom:8px">Detalhe</th><th style="padding-bottom:8px">Valor</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted)">Nenhum lançamento encontrado neste filtro.</td></tr>'}</tbody></table></div><div style="text-align:center;margin-top:20px;font-size:10px;color:#999;">Relatório gerado em ${new Date().toLocaleString()}</div></div>`;
    $('relFilterSelect').addEventListener('change', (e) => { state.relatorioFilter = e.target.value; renderRelatorios(); });
}
function downloadPDF() {
    const element = document.getElementById('print-area');
    const opt = { margin: 10, filename: `extrato-${state.relatorioFilter}-${state.anoMes}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, backgroundColor: '#0f1221' }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    if (window.html2pdf) { toast('Gerando PDF... aguarde.'); window.html2pdf().set(opt).from(element).save(); } else { toast('Erro: Biblioteca PDF não carregada.'); }
}

async function renderDashboard() {
    const content = $('pageContent'); if (!state.veiculoId) { content.innerHTML = `<div class="card panel"><div class="panel-title">Você ainda não tem veículo cadastrado</div></div>`; return; }
    const dash = await api('getDashboard', [state.token, { veiculoId: state.veiculoId, anoMes: state.anoMes }]);
    content.innerHTML = `<div class="cards"><div class="card kpi"><div class="k">Total do mês</div><div class="v">${money(dash.total)}</div></div><div class="card kpi"><div class="k">Km rodados</div><div class="v">${num(dash.totalKm, 0)} km</div></div><div class="card kpi"><div class="k">Consumo médio</div><div class="v">${dash.consumoMedio ? num(dash.consumoMedio, 2) : '—'}</div></div><div class="card kpi"><div class="k">Custo por km</div><div class="v">${dash.custoPorKm ? money(dash.custoPorKm) : '—'}</div></div></div><div class="card panel"><div class="panel-title">Totais por tipo</div>${renderKeyValueTable(dash.porTipo)}</div><div class="card panel"><div class="panel-title">Totais por categoria</div>${renderKeyValueTable(dash.porCategoria)}</div>`;
}
function renderKeyValueTable(obj) {
    const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]); if (!entries.length) return `<div style="color:var(--muted);font-size:13px">Sem dados.</div>`;
    const rows = entries.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${money(v)}</td></tr>`).join('');
    return `<table class="table"><thead><tr><th>Item</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
}
async function renderLancamentos({ tipo }) {
    const content = $('pageContent'); if (!state.veiculoId) { content.innerHTML = `<div class="card panel">Cadastre um veículo primeiro.</div>`; return; }
    const list = await api('listLancamentos', [state.token, { veiculoId: state.veiculoId, anoMes: state.anoMes, tipo }]); state.lancamentos = list || [];
    const rows = state.lancamentos.map(it => {
        const tag = it.tipo === 'Abastecimento' ? `<span class="tag ok">⛽ ${escapeHtml(it.tipo)}</span>` : it.tipo === 'Manutenção' ? `<span class="tag warn">🛠️ ${escapeHtml(it.tipo)}</span>` : `<span class="tag">${escapeHtml(it.tipo)}</span>`;
        const extra = it.tipo === 'Abastecimento' ? `<div style="color:var(--muted);font-size:12px;margin-top:3px">${it.litros ? `${num(it.litros, 2)} L` : ''}</div>` : '';
        return `<tr><td><div style="font-weight:800">${escapeHtml(it.data.split('-').reverse().join('/'))}</div><div style="color:var(--muted);font-size:12px">${escapeHtml(it.categoria || '')}</div></td><td>${tag}<div style="margin-top:6px">${escapeHtml(it.descricao || '')}</div>${extra}</td><td>${money(it.valor)}</td><td style="white-space:nowrap"><button class="btn ghost" onclick="editLanc('${it.id}')">Editar</button><button class="btn danger" onclick="delLanc('${it.id}')">Excluir</button></td></tr>`;
    }).join('');
    content.innerHTML = `<div class="card panel"><div class="panel-title">Itens (${state.lancamentos.length})</div><table class="table"><thead><tr><th>Data</th><th>Detalhes</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${rows || `<tr><td colspan="4" style="color:var(--muted)">Sem lançamentos.</td></tr>`}</tbody></table></div>`;
}
async function renderVeiculos() {
    const content = $('pageContent'); const list = await api('listVeiculos', [state.token]); const veics = list || [];
    const rows = veics.map(v => `<tr><td style="font-weight:900">${escapeHtml(v.nome || '')}</td><td>${escapeHtml(v.placa || '')}</td><td>${escapeHtml(v.ano || '')}</td><td>${v.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag bad">Inativo</span>'}</td><td style="white-space:nowrap"><button class="btn ghost" onclick="editVeic('${v.id}')">Editar</button><button class="btn danger" onclick="delVeic('${v.id}')">Excluir</button></td></tr>`).join('');
    content.innerHTML = `<div class="card panel"><div class="panel-title">Cadastrar / editar</div><div class="grid2 gap"><label class="field"><span>Nome</span><input id="vNome" type="text" placeholder="ex: Compass"></label><label class="field"><span>Placa</span><input id="vPlaca" type="text" placeholder="ABC-1234"></label><label class="field"><span>Ano</span><input id="vAno" type="text" placeholder="2020"></label><label class="field"><span>Ativo</span><select id="vAtivo"><option value="true">Sim</option><option value="false">Não</option></select></label></div><label class="field" style="margin-top:10px"><span>Observações</span><input id="vObs" type="text"></label><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="btn ghost" onclick="clearVeicForm()">Limpar</button><button class="btn primary" onclick="saveVeic()">Salvar veículo</button></div></div><div class="card panel"><div class="panel-title">Lista de veículos</div><table class="table"><thead><tr><th>Nome</th><th>Placa</th><th>Ano</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Nenhum veículo.</td></tr>`}</tbody></table></div>`;
    window.__editVeicId = '';
}
function clearVeicForm() { window.__editVeicId = ''; $('vNome').value = ''; $('vPlaca').value = ''; $('vAno').value = ''; $('vObs').value = ''; $('vAtivo').value = 'true'; toast('Form limpo.'); }
async function saveVeic() { const payload = { id: window.__editVeicId || '', nome: $('vNome').value.trim(), placa: $('vPlaca').value.trim(), ano: $('vAno').value.trim(), observacoes: $('vObs').value.trim(), ativo: $('vAtivo').value === 'true' }; if (!payload.nome) return toast('Informe o nome.'); await api('saveVeiculo', [state.token, payload]); toast('Veículo salvo!'); await loadVeiculos(); $('vehicleSelect').value = state.veiculoId; await renderVeiculos(); }
async function editVeic(id) { const v = (await api('listVeiculos', [state.token])).find(x => x.id === id); if (!v) return; window.__editVeicId = v.id; $('vNome').value = v.nome; $('vPlaca').value = v.placa; $('vAno').value = v.ano; $('vObs').value = v.observacoes; $('vAtivo').value = v.ativo ? 'true' : 'false'; toast('Editando...'); }
async function delVeic(id) { if (confirm('Excluir?')) { await api('deleteVeiculo', [state.token, id]); toast('Excluído.'); await loadVeiculos(); await routeTo(state.route); } }

async function renderAjustes() {
    const content = $('pageContent');
    const tiposText = (state.ajustes.tipos || []).join('\n'); const pgtoText = (state.ajustes.pagamentos || []).join('\n'); const locaisText = (state.ajustes.locais || []).join('\n');
    const tipos = state.ajustes.tipos || []; const tipoOptions = tipos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    content.innerHTML = `<div class="card panel"><div class="panel-title">⚙️ Ajustes de listas</div><div style="color:var(--muted);font-size:13px;line-height:1.4;margin-bottom:10px">Edite as listas que aparecem nos menus (dropdowns).</div><div class="grid2 gap"><div><div style="font-weight:900;margin-bottom:6px">Tipos</div><textarea id="ajTipos">${escapeHtml(tiposText)}</textarea></div><div><div style="font-weight:900;margin-bottom:6px">Formas de Pagamento</div><textarea id="ajPgto">${escapeHtml(pgtoText)}</textarea></div><div><div style="font-weight:900;margin-bottom:6px">Locais (Postos/Oficinas)</div><textarea id="ajLocais">${escapeHtml(locaisText)}</textarea></div></div><div style="margin-top:12px"><div style="font-weight:900;margin-bottom:6px">Categorias por Tipo</div><div class="grid2 gap"><label class="field"><span>Tipo</span><select id="ajTipoSel">${tipoOptions}</select></label><div></div></div><textarea id="ajCats" placeholder="1 por linha..."></textarea></div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="btn ghost" onclick="restoreDefaults()">Restaurar padrão</button><button class="btn primary" onclick="saveAjustesUI()">Salvar ajustes</button></div></div>`;
    const sel = $('ajTipoSel'); const cats = $('ajCats'); const loadCats = () => { const t = sel.value; const arr = (state.ajustes.categoriasPorTipo && state.ajustes.categoriasPorTipo[t]) ? state.ajustes.categoriasPorTipo[t] : []; cats.value = (arr || []).join('\n'); }; sel.addEventListener('change', loadCats); loadCats();
}
async function saveAjustesUI() {
    const tipos = uniqueCleanLines($('ajTipos').value); const pagamentos = uniqueCleanLines($('ajPgto').value); const locais = uniqueCleanLines($('ajLocais').value);
    if (!tipos.includes('Abastecimento')) tipos.unshift('Abastecimento'); if (!tipos.includes('Manutenção')) tipos.unshift('Manutenção');
    const tipoSel = $('ajTipoSel').value; const catsSel = uniqueCleanLines($('ajCats').value); const categoriasPorTipo = Object.assign({}, state.ajustes.categoriasPorTipo || {}); categoriasPorTipo[tipoSel] = catsSel;
    const payload = { tipos, pagamentos, locais, categoriasPorTipo }; try { await api('saveAjustes', [state.token, payload]); toast('Ajustes salvos!'); await loadAjustes(); await routeTo('ajustes'); } catch (e) { toast('Erro ao salvar.'); }
}
async function restoreDefaults() { if (confirm('Restaurar tudo para o padrão?')) { await api('saveAjustes', [state.token, JSON.parse(JSON.stringify(DEFAULTS))]); toast('Restaurado!'); await loadAjustes(); await routeTo('ajustes'); } }

async function renderUsuarios() {
    const content = $('pageContent'); const list = await api('listUsuarios', [state.token]); const users = list || [];
    const rows = users.map(u => `<tr><td style="font-weight:900">${escapeHtml(u.usuario || '')}</td><td>${escapeHtml(u.nome || '')}</td><td><span class="tag ${u.perfil==='ADMIN'?'ok':''}">${escapeHtml(u.perfil || 'CLIENTE')}</span></td><td style="white-space:nowrap"><button class="btn ghost" onclick="editUsuario('${u.id}')">Editar</button><button class="btn danger" onclick="delUsuario('${u.id}')">Excluir</button></td></tr>`).join('');
    content.innerHTML = `<div class="card panel"><div class="panel-title">Cadastrar Usuário</div><div class="grid2 gap"><label class="field"><span>Login (Usuário)</span><input id="uUser" type="text" placeholder="ex: joao"></label><label class="field"><span>Senha</span><input id="uPass" type="text" placeholder="****"></label><label class="field"><span>Nome Completo</span><input id="uNome" type="text" placeholder="João Silva"></label><label class="field"><span>Perfil</span><select id="uPerfil"><option value="ADMIN">ADMIN (Acesso Total)</option><option value="CLIENTE">CLIENTE (Apenas Dashboard)</option></select></label></div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="btn ghost" onclick="clearUsuarioForm()">Limpar</button><button class="btn primary" onclick="saveUsuario()">Salvar Usuário</button></div></div><div class="card panel"><div class="panel-title">Lista de Usuários</div><table class="table"><thead><tr><th>Login</th><th>Nome</th><th>Perfil</th><th>Ações</th></tr></thead><tbody>${rows || `<tr><td colspan="4">Nenhum usuário.</td></tr>`}</tbody></table></div>`; window.__editUserId = '';
}
function clearUsuarioForm() { window.__editUserId = ''; $('uUser').value = ''; $('uPass').value = ''; $('uNome').value = ''; $('uPerfil').value = 'CLIENTE'; toast('Formulário limpo.'); }
async function saveUsuario() { const payload = { id: window.__editUserId || '', usuario: $('uUser').value.trim(), senha: $('uPass').value.trim(), nome: $('uNome').value.trim(), perfil: $('uPerfil').value, ativo: true }; if (!payload.usuario || !payload.senha) return toast('Informe usuário e senha.'); await api('saveUsuario', [state.token, payload]); toast('Usuário salvo!'); await renderUsuarios(); }
async function editUsuario(id) { const list = await api('listUsuarios', [state.token]); const u = list.find(x => x.id === id); if (!u) return; window.__editUserId = u.id; $('uUser').value = u.usuario; $('uPass').value = u.senha; $('uNome').value = u.nome; $('uPerfil').value = u.perfil || 'CLIENTE'; toast('Editando usuário...'); }
async function delUsuario(id) { if(state.user.id === id) return toast('Você não pode se excluir!'); if (confirm('Excluir usuário?')) { await api('deleteUsuario', [state.token, id]); toast('Excluído.'); await renderUsuarios(); } }

function openModal() {
    if (!state.veiculoId) return toast('Cadastre um veículo primeiro.');
    $('modal').classList.remove('hidden'); $('fData').value = new Date().toISOString().slice(0, 10);
    buildTipoSelect(); $('fTipo').value = 'Abastecimento';
    updateCategoriaSelect(); updateLocalSelect(); updatePgtoSelect();
    $('fValor').value = ''; $('fLitros').value = ''; $('fOdo').value = ''; $('fDesc').value = '';
    window.__editLancId = ''; window.__servicos = []; $('modalTitle').textContent = 'Novo lançamento';
    $('fCategoria').value = defaultCategoriaByTipo('Abastecimento'); toggleModoManutencao();
}
function closeModal() { $('modal').classList.add('hidden'); }
async function saveLanc() {
    const tipo = $('fTipo').value; const base = { data: $('fData').value, veiculoId: state.veiculoId, tipo, descricao: $('fDesc').value.trim(), odometro: $('fOdo').value, local: $('fLocal').value, formaPgto: $('fPgto').value };
    if (!base.odometro) return toast('Informe o odômetro (km).');
    if (tipo === 'Manutenção') {
        const servs = (window.__servicos || []).map(s => ({ categoria: String(s.categoria || '').trim(), valor: s.valor })).filter(s => s.categoria && Number(s.valor || 0) > 0);
        if (!servs.length) return toast('Adicione pelo menos 1 serviço com valor.');
        try { const items = servs.map(s => ({ ...base, categoria: s.categoria, valor: s.valor, litros: 0 })); if (window.__editLancId) { await api('updateLancamento', [state.token, { id: window.__editLancId, ...base, categoria: servs[0].categoria, valor: servs[0].valor, litros: 0 }]); if(servs.length > 1) await api('addLancamentosBatch', [state.token, servs.slice(1).map(s=>({...base, categoria:s.categoria, valor:s.valor, litros:0}))]); } else { await api('addLancamentosBatch', [state.token, items]); } toast('Salvo!'); closeModal(); await routeTo(state.route); } catch(e) { toast('Erro ao salvar.'); }
        return;
    }
    const payload = { id: window.__editLancId || '', ...base, categoria: $('fCategoria').value, valor: $('fValor').value, litros: (tipo === 'Abastecimento') ? $('fLitros').value : 0 };
    if (!payload.valor) return toast('Informe o valor.'); if (tipo === 'Abastecimento' && !payload.litros) return toast('Informe os litros.');
    try { if (payload.id) { await api('updateLancamento', [state.token, payload]); toast('Atualizado!'); } else { await api('addLancamento', [state.token, payload]); toast('Salvo!'); } closeModal(); await routeTo(state.route); } catch (e) { toast('Erro ao salvar.'); }
}
async function delLanc(id) { if(confirm('Excluir?')) { await api('deleteLancamento', [state.token, id]); toast('Excluído.'); await routeTo(state.route); } }
function editLanc(id) {
    const it = (state.lancamentos || []).find(x => x.id === id); if (!it) return;
    $('modal').classList.remove('hidden'); window.__editLancId = it.id;
    $('fData').value = it.data.split('T')[0];
    buildTipoSelect(); $('fTipo').value = it.tipo || 'Outros';
    updateCategoriaSelect(); updateLocalSelect(); updatePgtoSelect();
    $('fLocal').value = it.local || ''; $('fPgto').value = it.formaPgto || ''; $('fOdo').value = it.odometro ?? ''; $('fDesc').value = it.descricao || '';
    if ($('fTipo').value === 'Manutenção') { window.__servicos = [{ categoria: it.categoria || defaultCategoriaByTipo('Manutenção'), valor: it.valor ?? '' }]; toggleModoManutencao(); } else { window.__servicos = []; $('fCategoria').value = it.categoria || ''; $('fValor').value = it.valor ?? ''; $('fLitros').value = it.litros ?? ''; toggleModoManutencao(); }
    $('modalTitle').textContent = 'Editar lançamento';
}

document.addEventListener('DOMContentLoaded', async () => {
    $('btnLogin').addEventListener('click', doLogin); $('btnLogout').addEventListener('click', doLogout); $('btnNew').addEventListener('click', openModal); $('btnCloseModal').addEventListener('click', closeModal); $('btnCancel').addEventListener('click', closeModal); $('btnSave').addEventListener('click', saveLanc); $('btnToggleMenu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
    document.querySelectorAll('.menu-item').forEach(btn => btn.addEventListener('click', async () => { document.querySelector('.sidebar').classList.remove('open'); await routeTo(btn.dataset.route); }));
    $('vehicleSelect').addEventListener('change', async () => { state.veiculoId = $('vehicleSelect').value; await routeTo(state.route); }); $('monthSelect').addEventListener('change', async () => { state.anoMes = $('monthSelect').value || ymNow(); await routeTo(state.route); });
    $('btnSetup').addEventListener('click', async () => { if (!confirm('Isso vai resetar configurações (no Supabase, isso apenas checa a tabela Ajustes). Continuar?')) return; try { await api('setup', []); toast('Setup verificado! Login admin/1234'); } catch (e) { toast('Erro.'); } });
    $('fTipo').addEventListener('change', () => { updateCategoriaSelect(); toggleModoManutencao(); }); $('btnAddServico').addEventListener('click', addServico);
    if (await tryAutoLogin()) await bootApp(); else { $('appView').classList.add('hidden'); $('loginView').classList.remove('hidden'); $('monthSelect').value = ymNow(); }
});
function escapeHtml(str) { return String(str || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", "&#039;"); }
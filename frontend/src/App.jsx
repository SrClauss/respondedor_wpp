import React, { useState } from 'react';
import * as XLSX from 'xlsx';

const WIZARD_PASSOS = ['Identificação', 'Interações', 'Revisão'];

const WIZARD_OPCOES_ESPERA = [
  { value: 'qualquer_mensagem', label: 'Qualquer Mensagem (1 apenas)' },
  { value: 'multiplas_mensagens', label: 'Aguardar Múltiplas Mensagens (N)' },
  { value: 'texto_exato', label: 'Conter um Texto Específico' },
  { value: 'regex', label: 'Corresponder a um Padrão (Regex)' },
  { value: 'arquivo', label: 'Receber um Documento/Arquivo' }
];

export const isDynamicParam = (interacao) => {
  if (!interacao) return false;
  if (interacao.tipo_resposta === 'enviar_coluna') return true;
  if (interacao.tipo_resposta === 'enviar_texto_fixo') return false;
  if (interacao.tipo_resposta === 'baixar_e_continuar') return false;
  if (interacao.tipo_resposta === 'finalizar_baixar' || interacao.tipo_resposta === 'finalizar_sucesso') return false;
  
  const val = (interacao.valor_resposta || '').trim();
  if (!val) return false;
  if (val.startsWith('{') && val.endsWith('}')) return true;
  if (/^\d+$/.test(val)) return false;
  if (val.includes('\n')) return false;
  const fixos = ['sair', 'voltar', 'menu', 'sim', 'nao', 'não', 'ficar neste canal', 'financeiro', 'ola', 'oi'];
  if (fixos.includes(val.toLowerCase())) return false;
  const colunasTipicas = ['cpf', 'cnpj', 'telefone', 'celular', 'nome', 'matricula', 'numero', 'email'];
  if (colunasTipicas.includes(val.toLowerCase())) return true;
  if (val.includes(' ') || val.length > 25) return false;
  return true;
};

const WIZARD_OPCOES_RESPOSTA = [
  { value: 'enviar_texto_fixo', label: '💬 Enviar Texto Fixo (Menu / Opção Fixa)' },
  { value: 'enviar_coluna', label: '📊 Enviar Dado da Planilha (Variável por Cliente)' },
  { value: 'baixar_e_continuar', label: '📥 Baixar Arquivo e Continuar Fluxo' },
  { value: 'finalizar_sucesso', label: '🏁 Finalizar Fluxo com Sucesso' },
  { value: 'finalizar_baixar', label: '💾 Finalizar e Baixar Arquivo' }
];

export const rotuloColuna = (col) => {
  if (col === 'mensagem_inicial') return 'Mensagem inicial';
  if (col === 'telefone') return 'Telefone destino';
  const m = /^passo_(\d+)_?(.*)$/.exec(col);
  if (m) return m[2] ? `Passo ${m[1]} · ${m[2].replace(/_+/g, ' ').trim()}` : `Passo ${m[1]}`;
  return col;
};

export const contarPassosCegosSeguidos = (interacoes) => {
  let max = 0, atual = 0;
  (interacoes || []).forEach((i) => {
    if (i.tipo_espera === 'qualquer_mensagem') { atual += 1; max = Math.max(max, atual); }
    else atual = 0;
  });
  return max;
};

function App() {
  const [tab, setTab] = useState('fluxos');
  const [fluxos, setFluxos] = useState([]);
  const [editorExpandido, setEditorExpandido] = useState(true);
  const [expandedCards, setExpandedCards] = useState({});

  const [novoFluxoNome, setNovoFluxoNome] = useState('');
  const [novoReceptor, setNovoReceptor] = useState('');
  const [novaMensagemInicial, setNovaMensagemInicial] = useState('');

  // Wizard state
  const [wizardAberto, setWizardAberto] = useState(false);
  const [wizardPasso, setWizardPasso] = useState(0);
  const [wizardDados, setWizardDados] = useState({
    nome: '',
    receptor: '',
    mensagemInicial: '',
    interacoes: [{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]
  });
  
  // WPP Connection state
  const [wppStatus, setWppStatus] = useState('desconectado');
  const [qrCodeData, setQrCodeData] = useState(null);
  
  // Toast notification state
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // CSV / XLSX Lote State por Fluxo
  const [flowUploads, setFlowUploads] = useState({});
  const [previewFlowId, setPreviewFlowId] = useState(null);

  const toggleCardExpand = (id) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCSVUpload = (fluxo, e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const dataBuffer = new Uint8Array(event.target.result);
        const workbook = XLSX.read(dataBuffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rawJsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        if (!rawJsonData || rawJsonData.length === 0) {
          showToast("A planilha deve conter o cabeçalho e pelo menos uma linha de dados.", "error");
          return;
        }

        const data = rawJsonData.map(row => {
          let cleanRow = {};
          Object.keys(row).forEach(k => {
            const cleanKey = k.trim().replace(/\r/g, '');
            const cleanVal = typeof row[k] === 'string' ? row[k].trim().replace(/\r/g, '') : String(row[k]);
            cleanRow[cleanKey] = cleanVal;
          });
          return cleanRow;
        });

        const colunasEsperadas = extractParams(fluxo.interacoes, fluxo.mensagem_inicial, fluxo.receptor);
        const colunasPresentes = Object.keys(data[0] || {});
        const presentesNorm = colunasPresentes.map(c => c.toLowerCase().trim());
        
        const faltando = colunasEsperadas.filter(colEsp => {
          const norm = colEsp.toLowerCase().trim();
          const m = /^passo_(\d+)/.exec(norm);
          if (m) {
            const prefix = `passo_${m[1]}`;
            return !presentesNorm.some(p => p.startsWith(prefix));
          }
          return !presentesNorm.includes(norm);
        });

        setFlowUploads(prev => ({
          ...prev,
          [fluxo.id]: {
            fileName: file.name,
            rows: data,
            colunasPresentes,
            colunasFaltando: faltando,
            valido: faltando.length === 0
          }
        }));

        if (faltando.length > 0) {
          showToast(`Planilha "${file.name}" carregada (${data.length} linhas), mas atenção: faltam colunas (${faltando.join(', ')})!`, "warning");
        } else {
          showToast(`Planilha "${file.name}" pronta! ${data.length} cliente(s) validados com sucesso.`, "success");
        }
      } catch (err) {
        console.error("Erro ao ler arquivo XLSX/CSV:", err);
        showToast("Falha ao processar a planilha. Certifique-se de que é um arquivo .xlsx ou .csv válido.", "error");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };

  const iniciarExecucaoFluxoCSV = async (fluxo) => {
    const upload = flowUploads[fluxo.id];
    if (!upload || !upload.rows || upload.rows.length === 0) {
      showToast("Por favor, suba a planilha correspondente a este fluxo antes de iniciar.", "error");
      return;
    }
    
    if (!fluxo.receptor && !upload.colunasPresentes.some(c => c.toLowerCase() === 'telefone')) {
      showToast("Este fluxo não possui Receptor Fixo nem coluna 'telefone' na planilha.", "error");
      return;
    }

    const itensLote = upload.rows.map(row => {
      let params = {};
      Object.keys(row).forEach(k => {
        const val = row[k] !== undefined && row[k] !== null ? String(row[k]).trim() : '';
        params[k] = val;
        params[k.toLowerCase().trim()] = val;
      });
      return params;
    });

    try {
      const res = await fetch('/api/executar_lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fluxo_id: fluxo.id,
          telefone: fluxo.receptor || (upload.rows[0] && (upload.rows[0].telefone || upload.rows[0].Telefone)) || '',
          itens: itensLote
        })
      });
      const data = await res.json();
      
      if (!res.ok || data.error) {
        showToast(`Erro ao enfileirar lote: ${data.error}`, "error");
      } else {
        showToast(`🚀 Lote com ${data.total} cliente(s) enfileirado com sucesso!`, "success");
        setFlowUploads(prev => {
          const next = { ...prev };
          delete next[fluxo.id];
          return next;
        });
        if (previewFlowId === fluxo.id) setPreviewFlowId(null);
      }
    } catch (err) {
      console.error("Erro na requisição de lote:", err);
      showToast("Falha na comunicação com o servidor ao enviar o lote.", "error");
    }
  };

  const deletarFluxo = async (id) => {
    if (window.confirm("Tem certeza que deseja excluir este fluxo?")) {
      try {
        const res = await fetch(`/api/fluxos/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setFluxos(fluxos.filter(f => f.id !== id));
          showToast("Fluxo excluído com sucesso.", "info");
        } else {
          showToast("Falha ao excluir fluxo.", "error");
        }
      } catch (err) {
        console.error("Erro ao deletar fluxo", err);
        showToast("Erro ao comunicar com o servidor para excluir fluxo.", "error");
      }
    }
  };
  
  React.useEffect(() => {
    let interval;
    if (tab === 'whatsapp') {
      const fetchStatus = async () => {
        try {
          let res = await fetch('/api/wpp/status').catch(() => null);
          if (!res || !res.ok) {
            const host = window.location.hostname || 'localhost';
            res = await fetch(`http://${host}:3001/api/wpp/status`).catch(() => null);
          }
          if (res && res.ok) {
            const data = await res.json();
            setWppStatus(data.status);
            setQrCodeData(data.qr);
          }
        } catch (e) {
          console.error("Erro ao checar status do WPP", e);
        }
      };
      fetchStatus();
      interval = setInterval(fetchStatus, 2500);
    }
    return () => clearInterval(interval);
  }, [tab]);

  const [interacoes, setInteracoes] = useState([
    { 
      tipo_espera: 'qualquer_mensagem', 
      valor_espera: '', 
      tipo_resposta: 'enviar_texto', 
      valor_resposta: '' 
    }
  ]);

  const [logs, setLogs] = useState([]);

  React.useEffect(() => {
    let interval;
    if (tab === 'execucoes') {
      const fetchLogs = async () => {
        try {
          const res = await fetch('/api/logs');
          const data = await res.json();
          setLogs(data);
        } catch (e) {
          console.error("Erro ao carregar logs", e);
        }
      };
      fetchLogs();
      interval = setInterval(fetchLogs, 2000);
    }
    return () => clearInterval(interval);
  }, [tab]);

  const extractParams = (interactions, msgInicial, receptor) => {
    const params = [];
    if (!receptor || receptor === 'Não informado' || !receptor.trim()) {
      params.push("telefone");
    }
    params.push("mensagem_inicial");

    (interactions || []).forEach((i, idx) => {
      const passoNum = idx + 1;
      const rawVal = (i.valor_resposta || '').trim().replace(/[{}]/g, '');
      const slug = rawVal ? `_${rawVal.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15)}` : '';
      params.push(`passo_${passoNum}${slug}`);
    });
    
    return params;
  };

  const addInteracao = () => {
    const novoPasso = {
      tipo_espera: 'qualquer_mensagem',
      valor_espera: '',
      tipo_resposta: 'enviar_texto_fixo',
      valor_resposta: ''
    };
    setInteracoes((prev) => [...prev, novoPasso]);
    setTimeout(() => {
      const el = document.getElementById('fim-da-lista-interacoes');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  };

  const removeInteracao = (index) => {
    const novas = [...interacoes];
    novas.splice(index, 1);
    setInteracoes(novas);
  };

  const moveInteracao = (index, direction) => {
    const destino = index + direction;
    if (destino < 0 || destino >= interacoes.length) return;
    const novas = [...interacoes];
    [novas[index], novas[destino]] = [novas[destino], novas[index]];
    setInteracoes(novas);
  };

  const duplicarInteracao = (index) => {
    const novas = [...interacoes];
    const clone = JSON.parse(JSON.stringify(novas[index]));
    novas.splice(index + 1, 0, clone);
    setInteracoes(novas);
  };

  const updateInteracao = (index, field, value) => {
    const novas = [...interacoes];
    novas[index][field] = value;
    
    if (field === 'tipo_espera' && (value === 'qualquer_mensagem' || value === 'arquivo')) {
      novas[index].valor_espera = '';
    }
    if (field === 'tipo_resposta' && value === 'finalizar_sucesso') {
      novas[index].valor_resposta = '';
    }
    
    setInteracoes(novas);
  };

  const updateFluxoLateral = (index, field, value) => {
    const novas = [...interacoes];
    if (!novas[index].fluxo_lateral) {
      novas[index].fluxo_lateral = {
        ativo: false,
        nome: '',
        interacoes: [{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }],
        acao_conclusao: 'AvancarParaProximaLinha'
      };
    }
    novas[index].fluxo_lateral[field] = value;
    setInteracoes(novas);
  };

  const addPassoLateral = (mainIndex) => {
    const novas = [...interacoes];
    if (!novas[mainIndex].fluxo_lateral) {
      novas[mainIndex].fluxo_lateral = {
        ativo: true,
        nome: '',
        interacoes: [],
        acao_conclusao: 'AvancarParaProximaLinha'
      };
    }
    if (!novas[mainIndex].fluxo_lateral.interacoes) {
      novas[mainIndex].fluxo_lateral.interacoes = [];
    }
    novas[mainIndex].fluxo_lateral.interacoes.push({
      tipo_espera: 'qualquer_mensagem',
      valor_espera: '',
      tipo_resposta: 'enviar_texto',
      valor_resposta: ''
    });
    setInteracoes(novas);
  };

  const removePassoLateral = (mainIndex, lateralIndex) => {
    const novas = [...interacoes];
    if (novas[mainIndex].fluxo_lateral && novas[mainIndex].fluxo_lateral.interacoes) {
      novas[mainIndex].fluxo_lateral.interacoes.splice(lateralIndex, 1);
    }
    setInteracoes(novas);
  };

  const updatePassoLateral = (mainIndex, lateralIndex, field, value) => {
    const novas = [...interacoes];
    if (novas[mainIndex].fluxo_lateral && novas[mainIndex].fluxo_lateral.interacoes) {
      novas[mainIndex].fluxo_lateral.interacoes[lateralIndex][field] = value;
    }
    setInteracoes(novas);
  };

  const validateRegex = (regex) => {
    if (!regex) return true;
    try {
      new RegExp(regex);
      return true;
    } catch (e) {
      showToast("Expressão Regular (Regex) inválida: " + e.message, "error");
      return false;
    }
  };

  React.useEffect(() => {
    fetch('/api/fluxos')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setFluxos(data);
      })
      .catch(err => console.error("Erro ao carregar fluxos:", err));
  }, []);

  const [fluxoEmEdicaoId, setFluxoEmEdicaoId] = useState(null);

  const carregarFluxoParaEdicao = (fluxo) => {
    setFluxoEmEdicaoId(fluxo.id);
    setNovoFluxoNome(fluxo.nome || '');
    setNovoReceptor(fluxo.receptor === 'Não informado' ? '' : (fluxo.receptor || ''));
    setNovaMensagemInicial(fluxo.mensagem_inicial || '');
    setInteracoes(fluxo.interacoes && fluxo.interacoes.length > 0 ? fluxo.interacoes : [{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]);
    setEditorExpandido(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelarEdicao = () => {
    setFluxoEmEdicaoId(null);
    setNovoFluxoNome('');
    setNovoReceptor('');
    setNovaMensagemInicial('');
    setInteracoes([{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]);
  };

  const abrirWizard = () => {
    setWizardDados({
      nome: novoFluxoNome || '',
      receptor: novoReceptor === 'Não informado' ? '' : (novoReceptor || ''),
      mensagemInicial: novaMensagemInicial || '',
      interacoes: interacoes.length > 0
        ? interacoes.map((i) => ({ ...i }))
        : [{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]
    });
    setWizardPasso(0);
    setWizardAberto(true);
  };

  const fecharWizard = () => {
    setWizardAberto(false);
    setWizardPasso(0);
  };

  const atualizarWizardDados = (campo, valor) => {
    setWizardDados((prev) => ({ ...prev, [campo]: valor }));
  };

  const atualizarWizardInteracao = (index, field, value) => {
    setWizardDados((prev) => {
      if (!prev.interacoes[index]) return prev;
      const novas = prev.interacoes.map((i, idx) => (idx === index ? { ...i } : i));
      novas[index][field] = value;
      if (field === 'tipo_espera' && (value === 'qualquer_mensagem' || value === 'arquivo')) {
        novas[index].valor_espera = '';
      }
      if (field === 'tipo_resposta' && (value === 'finalizar_sucesso' || value === 'finalizar_baixar')) {
        novas[index].valor_resposta = '';
      }
      return { ...prev, interacoes: novas };
    });
  };

  const adicionarWizardInteracao = () => {
    setWizardDados((prev) => ({
      ...prev,
      interacoes: [...prev.interacoes, { tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto_fixo', valor_resposta: '' }]
    }));
  };

  const removerWizardInteracao = (index) => {
    setWizardDados((prev) => ({
      ...prev,
      interacoes: prev.interacoes.filter((_, idx) => idx !== index)
    }));
  };

  const moverWizardInteracao = (index, direcao) => {
    setWizardDados((prev) => {
      const destino = index + direcao;
      if (destino < 0 || destino >= prev.interacoes.length) return prev;
      const novas = [...prev.interacoes];
      [novas[index], novas[destino]] = [novas[destino], novas[index]];
      return { ...prev, interacoes: novas };
    });
  };

  const descreverEsperaWizard = (i) => {
    switch (i.tipo_espera) {
      case 'qualquer_mensagem': return 'qualquer mensagem';
      case 'multiplas_mensagens': return `aguardar ${i.valor_espera || 'N'} mensagem(ns)`;
      case 'texto_exato': return `a mensagem conter "${i.valor_espera}"`;
      case 'regex': return `a mensagem corresponder ao padrão "${i.valor_espera}"`;
      case 'arquivo': return 'receber um documento/arquivo';
      default: return i.tipo_espera;
    }
  };

  const descreverRespostaWizard = (i) => {
    switch (i.tipo_resposta) {
      case 'enviar_coluna': return `enviar o dado da coluna "${i.valor_resposta || 'cpf'}" da planilha`;
      case 'enviar_texto_fixo': return `enviar o texto fixo "${i.valor_resposta || ''}"`;
      case 'enviar_texto':
        return isDynamicParam(i)
          ? `enviar o dado da coluna "${i.valor_resposta || 'cpf'}" da planilha`
          : `enviar o texto fixo "${i.valor_resposta || ''}"`;
      case 'baixar_e_continuar': return i.valor_resposta ? `baixar arquivo e enviar "${i.valor_resposta}"` : 'baixar arquivo e continuar fluxo';
      case 'finalizar_sucesso': return 'finalizar o fluxo com sucesso';
      case 'finalizar_baixar': return 'finalizar e baixar o arquivo';
      default: return i.tipo_resposta;
    }
  };

  const validarEtapaWizard = (passo) => {
    if (passo === 0) {
      if (!wizardDados.nome.trim()) { showToast('Informe o nome do fluxo antes de continuar.', 'warning'); return false; }
      if (!wizardDados.mensagemInicial.trim()) { showToast('Informe a mensagem inicial antes de continuar.', 'warning'); return false; }
      return true;
    }
    if (passo === 1) {
      for (let idx = 0; idx < wizardDados.interacoes.length; idx++) {
        const i = wizardDados.interacoes[idx];
        if (i.tipo_espera === 'multiplas_mensagens') {
          const n = parseInt(i.valor_espera, 10);
          if (!i.valor_espera || isNaN(n) || n < 1) { showToast(`Interação ${idx + 1}: informe a quantidade de mensagens a aguardar.`, 'warning'); return false; }
        }
        if ((i.tipo_espera === 'texto_exato' || i.tipo_espera === 'regex') && !i.valor_espera.trim()) {
          showToast(`Interação ${idx + 1}: informe o valor de espera.`, 'warning'); return false;
        }
        if (i.tipo_espera === 'regex' && i.valor_espera.trim()) {
          try { new RegExp(i.valor_espera); } catch (e) { showToast(`Interação ${idx + 1}: regex inválida - ${e.message}`, 'error'); return false; }
        }
        if ((i.tipo_resposta === 'enviar_texto' || i.tipo_resposta === 'enviar_coluna' || i.tipo_resposta === 'enviar_texto_fixo') && !i.valor_resposta.trim()) {
          showToast(`Interação ${idx + 1}: informe o texto ou coluna que será enviado.`, 'warning'); return false;
        }
      }
      const idxFinalizadorAntecipado = wizardDados.interacoes.findIndex((i, idx) =>
        idx < wizardDados.interacoes.length - 1 && (i.tipo_resposta === 'finalizar_sucesso' || i.tipo_resposta === 'finalizar_baixar')
      );
      if (idxFinalizadorAntecipado >= 0) {
        const seguir = window.confirm(`A Interação ${idxFinalizadorAntecipado + 1} finaliza o fluxo, então as interações seguintes nunca serão executadas. Deseja continuar mesmo assim?`);
        if (!seguir) return false;
      }
      return true;
    }
    return true;
  };

  const avancarWizard = () => {
    if (!validarEtapaWizard(wizardPasso)) return;
    setWizardPasso((p) => Math.min(WIZARD_PASSOS.length - 1, p + 1));
  };

  const aplicarWizard = () => {
    setNovoFluxoNome(wizardDados.nome.trim());
    setNovoReceptor(wizardDados.receptor.trim());
    setNovaMensagemInicial(wizardDados.mensagemInicial.trim());
    setInteracoes(wizardDados.interacoes.map((i) => ({ ...i })));
    setEditorExpandido(true);
    fecharWizard();
    showToast("Estrutura do assistente aplicada ao editor! Clique em 'Salvar Fluxo' para confirmar.", "info");
  };

  const criarFluxo = async (e) => {
    e.preventDefault();
    if (!novoFluxoNome || !novaMensagemInicial) {
      showToast('Preencha o nome do fluxo e a mensagem inicial.', 'warning');
      return;
    }
    
    const params = extractParams(interacoes, novaMensagemInicial, novoReceptor);

    const novo = {
      id: fluxoEmEdicaoId ? fluxoEmEdicaoId : `fluxo_${Date.now()}`,
      nome: novoFluxoNome,
      receptor: novoReceptor || 'Não informado',
      mensagem_inicial: novaMensagemInicial,
      interacoes: [...interacoes],
      parametros_exigidos: params
    };

    try {
      await fetch('/api/fluxos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novo)
      });

      if (fluxoEmEdicaoId) {
        setFluxos(fluxos.map(f => f.id === fluxoEmEdicaoId ? novo : f));
        showToast("Fluxo atualizado com sucesso!", "success");
      } else {
        setFluxos([...fluxos, novo]);
        showToast("Novo fluxo criado com sucesso!", "success");
      }

      cancelarEdicao();
    } catch (err) {
      console.error("Erro ao salvar fluxo", err);
      showToast("Erro ao salvar fluxo no banco de dados.", "error");
    }
  };

  const baixarModeloExcel = (fluxo) => {
    const colunas = [];

    if (!fluxo.receptor || fluxo.receptor === 'Não informado' || !fluxo.receptor.trim()) {
      colunas.push("telefone");
    }
    colunas.push("mensagem_inicial");

    (fluxo.interacoes || []).forEach((i, idx) => {
      const passoNum = idx + 1;
      const rawVal = (i.valor_resposta || '').trim().replace(/[{}]/g, '');
      const slug = rawVal ? `_${rawVal.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15)}` : '';
      colunas.push(`passo_${passoNum}${slug}`);
    });

    const exemplo1 = {};
    const exemplo2 = {};

    colunas.forEach((col, idx) => {
      if (col === "telefone") {
        exemplo1[col] = "5531999998888";
        exemplo2[col] = "5531988887777";
      } else if (col === "mensagem_inicial") {
        exemplo1[col] = fluxo.mensagem_inicial || "Ola";
        exemplo2[col] = fluxo.mensagem_inicial || "Ola";
      } else {
        const interacaoIdx = idx - (colunas.includes("telefone") ? 2 : 1);
        const inter = fluxo.interacoes && fluxo.interacoes[interacaoIdx];
        const val = inter ? (inter.valor_resposta || '').trim() : '';
        if (col.toLowerCase().includes("cpf")) {
          exemplo1[col] = "123.456.789-00";
          exemplo2[col] = "987.654.321-11";
        } else if (col.toLowerCase().includes("cnpj")) {
          exemplo1[col] = "12.345.678/0001-90";
          exemplo2[col] = "98.765.432/0001-01";
        } else {
          exemplo1[col] = val || `Passo ${interacaoIdx + 1}`;
          exemplo2[col] = val || `Passo ${interacaoIdx + 1}`;
        }
      }
    });

    const rows = [exemplo1, exemplo2];
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: colunas });
    worksheet['!cols'] = colunas.map(() => ({ wch: 22 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Clientes");
    
    const nomeSlug = fluxo.nome ? fluxo.nome.replace(/[^a-z0-9]/gi, '_').toLowerCase() : fluxo.id;
    XLSX.writeFile(workbook, `modelo_planilha_${nomeSlug}.xlsx`);
  };

  const exportarFluxoJSON = (fluxo) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fluxo, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `fluxo_${fluxo.nome ? fluxo.nome.replace(/[^a-z0-9]/gi, '_').toLowerCase() : fluxo.id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportarTodosFluxosJSON = () => {
    if (fluxos.length === 0) {
      showToast("Não há fluxos para exportar.", "warning");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fluxos, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `todos_os_fluxos_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("Arquivo JSON gerado e baixado com sucesso!", "success");
  };

  const importarFluxosJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonContent = JSON.parse(event.target.result);
        const listaFluxos = Array.isArray(jsonContent) ? jsonContent : [jsonContent];

        let importadosCount = 0;
        const novosFluxos = [...fluxos];

        for (const fluxo of listaFluxos) {
          if (!fluxo.nome || !fluxo.mensagem_inicial || !Array.isArray(fluxo.interacoes)) {
            console.warn("Objeto JSON ignorado por não estar no formato de fluxo válido:", fluxo);
            continue;
          }

          const fluxoParaSalvar = {
            ...fluxo,
            id: fluxo.id ? fluxo.id : `fluxo_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`
          };

          await fetch('/api/fluxos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fluxoParaSalvar)
          });

          const idx = novosFluxos.findIndex(f => f.id === fluxoParaSalvar.id);
          if (idx >= 0) {
            novosFluxos[idx] = fluxoParaSalvar;
          } else {
            novosFluxos.push(fluxoParaSalvar);
          }
          importadosCount++;
        }

        setFluxos(novosFluxos);
        showToast(`Sucesso! ${importadosCount} fluxo(s) importado(s) e salvo(s) no sistema.`, "success");
      } catch (err) {
        console.error("Erro ao importar JSON de fluxos:", err);
        showToast("Falha ao importar. Verifique se o arquivo JSON está no formato correto.", "error");
      }
    };

    reader.readAsText(file);
    e.target.value = null;
  };

  const gerarQrCode = async () => {
    setWppStatus('gerando');
    try {
      let res = await fetch('/api/wpp/connect', { method: 'POST' }).catch(() => null);
      if (!res || !res.ok) {
        const host = window.location.hostname || 'localhost';
        res = await fetch(`http://${host}:3001/api/wpp/connect`, { method: 'POST' }).catch(() => null);
      }
      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.status) setWppStatus(data.status);
        if (data?.qr) setQrCodeData(data.qr);
      }
    } catch (e) {
      console.error("Erro ao solicitar QR Code", e);
      setWppStatus('desconectado');
    }
  };

  const desconectarWpp = async () => {
    try {
      let res = await fetch('/api/wpp/disconnect', { method: 'POST' }).catch(() => null);
      if (!res || !res.ok) {
        const host = window.location.hostname || 'localhost';
        await fetch(`http://${host}:3001/api/wpp/disconnect`, { method: 'POST' }).catch(() => null);
      }
    } catch (e) {
      console.error("Erro ao desconectar WPP", e);
    }
    setWppStatus('desconectado');
    setQrCodeData(null);
  };

  return (
    <div className="wpp-orchestrator-root">
      {/* Design System Embutido para esmagar o CSS antigo e garantir layout SaaS Premium */}
      <style>{`
        :root {
          --primary: #38bdf8;
          --primary-hover: #0284c7;
          --success: #10b981;
          --danger: #ef4444;
          --warning: #f59e0b;
          --purple: #8b5cf6;
          --bg-dark: #090d16;
          --bg-card: #111827;
          --bg-elevated: #1e293b;
          --border: rgba(255, 255, 255, 0.09);
          --text-main: #f8fafc;
          --text-muted: #94a3b8;
        }
        .wpp-orchestrator-root {
          min-height: 100vh;
          background-color: var(--bg-dark);
          background-image: radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.08) 0%, transparent 55%);
          color: var(--text-main);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          padding-bottom: 80px;
        }
        .wpp-topbar {
          border-bottom: 1px solid var(--border);
          background: rgba(17, 24, 39, 0.85);
          backdrop-filter: blur(12px);
          position: sticky;
          top: 0;
          z-index: 40;
        }
        .wpp-topbar-inner {
          max-width: 1340px;
          margin: 0 auto;
          padding: 16px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 16px;
        }
        .wpp-main-container {
          max-width: 1340px;
          margin: 28px auto 0 auto;
          padding: 0 24px;
        }
        .wpp-nav-pills {
          display: flex;
          gap: 8px;
          background: rgba(0, 0, 0, 0.35);
          padding: 5px;
          border-radius: 12px;
          border: 1px solid var(--border);
        }
        .wpp-tab-btn {
          padding: 9px 16px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-weight: 600;
          font-size: 0.86rem;
          cursor: pointer;
          transition: all 0.18s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .wpp-tab-btn:hover {
          color: var(--text-main);
          background: rgba(255, 255, 255, 0.04);
        }
        .wpp-tab-btn.active {
          background: var(--primary);
          color: #090d16;
          font-weight: 700;
          box-shadow: 0 2px 10px rgba(56, 189, 248, 0.3);
        }
        .wpp-panel-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
          margin-bottom: 32px;
        }
        .wpp-input {
          width: 100%;
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.35);
          color: var(--text-main);
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          box-sizing: border-box;
        }
        .wpp-input:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
        }
        .wpp-input option {
          background: #0f172a;
          color: #f8fafc;
        }
        .wpp-label {
          display: block;
          font-size: 0.76rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          margin-bottom: 6px;
        }
        .wpp-step-card {
          background: rgba(30, 41, 59, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 18px;
          margin-bottom: 14px;
          transition: border-color 0.18s ease;
        }
        .wpp-step-card:hover {
          border-color: rgba(56, 189, 248, 0.3);
        }
        .wpp-step-btn {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #cbd5e1;
          padding: 5px 10px;
          border-radius: 8px;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .wpp-step-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
        }
        .wpp-step-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .wpp-step-btn-danger {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.3);
          color: #fca5a5;
        }
        .wpp-step-btn-danger:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.25);
          color: #fff;
        }
        /* GRELHA DE FLUXOS CONFIGURADOS: Fim do card espremido na esquerda! */
        .wpp-flows-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(390px, 1fr));
          gap: 20px;
          align-items: start;
        }
        @media (max-width: 640px) {
          .wpp-flows-grid {
            grid-template-columns: 1fr;
          }
        }
        .wpp-flow-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
          transition: transform 0.18s ease, border-color 0.18s ease;
        }
        .wpp-flow-card:hover {
          border-color: rgba(56, 189, 248, 0.35);
        }
        .wpp-pills-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .wpp-col-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(56, 189, 248, 0.22);
          padding: 4px 9px;
          border-radius: 8px;
          font-size: 0.74rem;
        }
        .wpp-pill-num {
          background: rgba(56, 189, 248, 0.2);
          color: var(--primary);
          font-weight: 800;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.68rem;
        }
        .wpp-pill-code {
          color: #64748b;
          font-family: monospace;
          font-size: 0.7rem;
        }
        .wpp-btn {
          border-radius: 10px;
          padding: 9px 16px;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          border: 1px solid transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.15s ease;
        }
        .wpp-btn-primary {
          background: var(--primary);
          color: #090d16;
        }
        .wpp-btn-primary:hover {
          background: #7dd3fc;
        }
        .wpp-btn-success {
          background: var(--success);
          color: #052e16;
        }
        .wpp-btn-success:hover:not(:disabled) {
          background: #34d399;
        }
      `}</style>

      {/* Toast flutuante de feedback */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
          background: toast.type === 'error' ? '#7f1d1d' : toast.type === 'warning' ? '#78350f' : toast.type === 'success' ? '#064e3b' : '#0c4a6e',
          border: `1px solid ${toast.type === 'error' ? '#f87171' : toast.type === 'warning' ? '#fbbf24' : toast.type === 'success' ? '#34d399' : '#38bdf8'}`,
          color: '#fff', padding: '14px 18px', borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '460px', fontSize: '0.88rem', fontWeight: 600
        }}>
          <span>
            {toast.type === 'success' && '✅ '}
            {toast.type === 'error' && '❌ '}
            {toast.type === 'warning' && '⚠️ '}
            {toast.type === 'info' && 'ℹ️ '}
            {toast.message}
          </span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.1rem', cursor: 'pointer', opacity: 0.8 }}>&times;</button>
        </div>
      )}

      {/* TOPBAR */}
      <header className="wpp-topbar">
        <div className="wpp-topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem' }}>
              🤖
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>
                Orquestrador WPP
              </h1>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Gestão de Automações, Regras & Disparos em Lote
              </p>
            </div>
          </div>

          <nav className="wpp-nav-pills">
            <button 
              className={`wpp-tab-btn ${tab === 'fluxos' ? 'active' : ''}`}
              onClick={() => setTab('fluxos')}
            >
              🧩 Fluxos ({fluxos.length})
            </button>
            <button 
              className={`wpp-tab-btn ${tab === 'whatsapp' ? 'active' : ''}`}
              onClick={() => setTab('whatsapp')}
            >
              📱 Conexão WhatsApp
            </button>
            <button 
              className={`wpp-tab-btn ${tab === 'execucoes' ? 'active' : ''}`}
              onClick={() => setTab('execucoes')}
            >
              ⚡ Execuções & Logs
            </button>
          </nav>
        </div>
      </header>

      <main className="wpp-main-container">
        {tab === 'fluxos' && (
          <div>
            {/* PAINEL DO EDITOR DE FLUXOS (Recolhível para não poluir a tela) */}
            <section className="wpp-panel-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: editorExpandido ? '20px' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: fluxoEmEdicaoId ? '#fbbf24' : 'var(--primary)' }}>
                    {fluxoEmEdicaoId ? `✏️ Editando Fluxo: ${novoFluxoNome}` : '✨ Criar Novo Fluxo de Automação'}
                  </h2>
                  <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.06)', padding: '3px 10px', borderRadius: '100px', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {interacoes.length} passo(s)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button 
                    type="button" 
                    onClick={abrirWizard} 
                    className="wpp-btn" 
                    style={{ background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.45)', color: '#c4b5fd', padding: '7px 14px', fontSize: '0.8rem' }}
                  >
                    🧙 Assistente Guiado (Wizard)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorExpandido(!editorExpandido)}
                    className="wpp-step-btn"
                    style={{ padding: '7px 12px', fontSize: '0.8rem' }}
                  >
                    {editorExpandido ? '🔼 Recolher Editor' : '🔽 Expandir Editor'}
                  </button>
                </div>
              </div>

              {editorExpandido && (
                <>
                  {fluxoEmEdicaoId && (
                    <div style={{ marginBottom: '16px', background: 'rgba(245, 158, 11, 0.1)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.35)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <span style={{ color: '#fde047', fontSize: '0.85rem', fontWeight: 600 }}>
                        ⚠️ Modo de edição ativo. Altere os passos abaixo e clique em Salvar Alterações.
                      </span>
                      <button type="button" onClick={cancelarEdicao} className="wpp-step-btn">
                        Cancelar Edição
                      </button>
                    </div>
                  )}

                  <form onSubmit={criarFluxo}>
                    {/* Linha 1: Nome + Telefone + Gatilho Inicial lado a lado no Desktop */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '20px' }}>
                      <div>
                        <label className="wpp-label">Nome do Fluxo *</label>
                        <input 
                          type="text" 
                          className="wpp-input"
                          placeholder="Ex: Consulta Boleto Unimed" 
                          value={novoFluxoNome}
                          onChange={(e) => setNovoFluxoNome(e.target.value)}
                          required
                        />
                      </div>

                      <div>
                        <label className="wpp-label">Telefone do Robô Receptor (Opcional)</label>
                        <input 
                          type="text" 
                          className="wpp-input"
                          placeholder="Ex: 552799887766 (ou vazio p/ usar planilha)" 
                          value={novoReceptor}
                          onChange={(e) => setNovoReceptor(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="wpp-label" style={{ color: 'var(--primary)' }}>🏁 Mensagem Inicial (Gatilho) *</label>
                        <input 
                          type="text" 
                          className="wpp-input"
                          style={{ borderColor: 'rgba(56, 189, 248, 0.4)', background: 'rgba(56, 189, 248, 0.06)' }}
                          placeholder="Primeira msg enviada (Ex: Olá)" 
                          value={novaMensagemInicial}
                          onChange={(e) => setNovaMensagemInicial(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    {/* Cabeçalho da Sequência de Passos */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                      <div>
                        <h3 style={{ color: 'var(--text-main)', fontSize: '1rem', fontWeight: 800, margin: 0 }}>
                          🪜 Sequência de Passos do Atendimento
                        </h3>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                          Configure o que o robô aguarda receber da URA/atendente e o que ele responde em seguida.
                        </p>
                      </div>
                    </div>

                    {/* Alerta de Passos Cegos Consecutivos */}
                    {contarPassosCegosSeguidos(interacoes) >= 3 && (
                      <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px', color: '#fcd34d', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                        <div>
                          <strong>Risco de dessincronização:</strong> Há {contarPassosCegosSeguidos(interacoes)} passos seguidos como &quot;Qualquer Mensagem&quot;. Se o robô de destino enviar 2 mensagens seguidas de boas-vindas, o nosso robô responderá cedo demais. Considere usar <em>&quot;Aguardar Múltiplas Mensagens&quot;</em> ou <em>&quot;Conter um Texto Específico&quot;</em>.
                        </div>
                      </div>
                    )}
                    
                    {/* Lista de Passos */}
                    <div>
                      {interacoes.map((interacao, index) => {
                        const lateralAtivo = Boolean(interacao.fluxo_lateral?.ativo);
                        return (
                          <div className="wpp-step-card" key={index}>
                            {/* Topo do Passo */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap', gap: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontWeight: 800, fontSize: '0.78rem', color: '#090d16', background: 'var(--primary)', padding: '3px 10px', borderRadius: '6px' }}>
                                  PASSO {index + 1}
                                </span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                  {interacao.tipo_resposta === 'enviar_coluna' || (interacao.tipo_resposta === 'enviar_texto' && isDynamicParam(interacao))
                                    ? '📊 Envia dado variável da planilha'
                                    : interacao.tipo_resposta === 'baixar_e_continuar'
                                    ? '📥 Baixa arquivo e continua'
                                    : interacao.tipo_resposta === 'finalizar_sucesso' || interacao.tipo_resposta === 'finalizar_baixar'
                                    ? '🏁 Encerramento do fluxo'
                                    : '💬 Envia texto fixo / opção'}
                                </span>
                              </div>

                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <button type="button" onClick={() => moveInteracao(index, -1)} disabled={index === 0} className="wpp-step-btn" title="Subir passo">
                                  ↑
                                </button>
                                <button type="button" onClick={() => moveInteracao(index, 1)} disabled={index === interacoes.length - 1} className="wpp-step-btn" title="Descer passo">
                                  ↓
                                </button>
                                <button type="button" onClick={() => duplicarInteracao(index)} className="wpp-step-btn" title="Duplicar este passo">
                                  📋 Duplicar
                                </button>
                                {interacoes.length > 1 && (
                                  <button type="button" onClick={() => removeInteracao(index)} className="wpp-step-btn wpp-step-btn-danger" title="Remover passo">
                                    🗑️
                                  </button>
                                )}
                              </div>
                            </div>
                            
                            {/* Grid 2 Colunas: Espera vs Ação */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
                              {/* Coluna 1: Espera */}
                              <div style={{ background: 'rgba(0,0,0,0.22)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <label className="wpp-label">1. O que o robô deve esperar?</label>
                                <select 
                                  className="wpp-input" 
                                  value={interacao.tipo_espera}
                                  onChange={(e) => updateInteracao(index, 'tipo_espera', e.target.value)}
                                  style={{ marginBottom: (interacao.tipo_espera !== 'qualquer_mensagem' && interacao.tipo_espera !== 'arquivo') ? '8px' : '0' }}
                                >
                                  <option value="qualquer_mensagem">Qualquer Mensagem (1 apenas)</option>
                                  <option value="multiplas_mensagens">Aguardar Múltiplas Mensagens (N)</option>
                                  <option value="texto_exato">Conter um Texto Específico</option>
                                  <option value="regex">Corresponder a um Padrão (Regex)</option>
                                  <option value="arquivo">Receber um Documento/Arquivo</option>
                                </select>
                                
                                {(interacao.tipo_espera === 'texto_exato' || interacao.tipo_espera === 'regex' || interacao.tipo_espera === 'multiplas_mensagens') && (
                                  <input 
                                    type={interacao.tipo_espera === 'multiplas_mensagens' ? 'number' : 'text'}
                                    min={interacao.tipo_espera === 'multiplas_mensagens' ? '2' : undefined}
                                    className="wpp-input" 
                                    placeholder={
                                      interacao.tipo_espera === 'texto_exato' ? 'Ex: Digite seu CPF' : 
                                      interacao.tipo_espera === 'regex' ? 'Ex: ^[0-9]{11}$' : 'Qtd de mensagens a esperar (ex: 3)'
                                    }
                                    value={interacao.valor_espera}
                                    onChange={(e) => updateInteracao(index, 'valor_espera', e.target.value)}
                                    onBlur={(e) => interacao.tipo_espera === 'regex' && validateRegex(e.target.value)}
                                    required
                                  />
                                )}
                              </div>

                              {/* Coluna 2: Resposta */}
                              <div style={{ background: 'rgba(0,0,0,0.22)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <label className="wpp-label">2. Qual será a ação do robô?</label>
                                <select 
                                  className="wpp-input" 
                                  value={
                                    interacao.tipo_resposta === 'enviar_texto'
                                      ? (isDynamicParam(interacao) ? 'enviar_coluna' : 'enviar_texto_fixo')
                                      : interacao.tipo_resposta
                                  }
                                  onChange={(e) => updateInteracao(index, 'tipo_resposta', e.target.value)}
                                  style={{ marginBottom: '8px' }}
                                >
                                  <option value="enviar_texto_fixo">💬 Enviar Texto Padrão (Menu / Opção)</option>
                                  <option value="enviar_coluna">📊 Enviar Dado da Planilha (Variável por Cliente)</option>
                                  <option value="baixar_e_continuar">📥 Baixar Arquivo e Continuar Fluxo</option>
                                  <option value="finalizar_sucesso">🏁 Finalizar Fluxo com Sucesso</option>
                                  <option value="finalizar_baixar">💾 Finalizar e Baixar Arquivo</option>
                                </select>
                                
                                {(interacao.tipo_resposta === 'enviar_texto_fixo' || (interacao.tipo_resposta === 'enviar_texto' && !isDynamicParam(interacao))) && (
                                  <div>
                                    <input 
                                      type="text" 
                                      className="wpp-input" 
                                      placeholder="Texto exato a enviar (Ex: 1, Financeiro, Sim)"
                                      value={interacao.valor_resposta}
                                      onChange={(e) => updateInteracao(index, 'valor_resposta', e.target.value)}
                                      required
                                    />
                                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '5px' }}>
                                      Coluna gerada: <code style={{ color: '#38bdf8' }}>{`passo_${index + 1}${interacao.valor_resposta ? '_' + interacao.valor_resposta.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15) : ''}`}</code>
                                    </span>
                                  </div>
                                )}

                                {(interacao.tipo_resposta === 'enviar_coluna' || (interacao.tipo_resposta === 'enviar_texto' && isDynamicParam(interacao))) && (
                                  <div>
                                    <input 
                                      type="text" 
                                      className="wpp-input" 
                                      style={{ borderColor: '#10b981', background: 'rgba(16, 185, 129, 0.08)' }}
                                      placeholder="Identificador do dado (Ex: cpf, cnpj, matricula)"
                                      value={interacao.valor_resposta}
                                      onChange={(e) => updateInteracao(index, 'valor_resposta', e.target.value)}
                                      required
                                    />
                                    <span style={{ fontSize: '0.72rem', color: '#6ee7b7', display: 'block', marginTop: '5px' }}>
                                      📊 Coluna variável por cliente: <code>{`passo_${index + 1}${interacao.valor_resposta ? '_' + interacao.valor_resposta.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15) : ''}`}</code>
                                    </span>
                                  </div>
                                )}

                                {interacao.tipo_resposta === 'baixar_e_continuar' && (
                                  <div>
                                    <input 
                                      type="text" 
                                      className="wpp-input" 
                                      placeholder="Texto opcional a enviar após baixar (Ex: Sair)"
                                      value={interacao.valor_resposta}
                                      onChange={(e) => updateInteracao(index, 'valor_resposta', e.target.value)}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Subfluxo Lateral (Discreto quando desativado, sem parecer erro vermelho!) */}
                            <div style={{ 
                              marginTop: '10px', 
                              background: lateralAtivo ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)', 
                              padding: '8px 12px', 
                              borderRadius: '8px', 
                              border: lateralAtivo ? '1px solid rgba(139, 92, 246, 0.35)' : '1px dashed rgba(255, 255, 255, 0.08)' 
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: lateralAtivo ? '#c4b5fd' : '#64748b', fontSize: '0.8rem' }}>
                                  <input 
                                    type="checkbox"
                                    checked={lateralAtivo}
                                    onChange={(e) => updateFluxoLateral(index, 'ativo', e.target.checked)}
                                    style={{ accentColor: '#8b5cf6' }}
                                  />
                                  🔀 Ativar Subfluxo de Exceção / Fallback (Caso este passo dê erro na URA)
                                </label>

                                {lateralAtivo && (
                                  <button 
                                    type="button" 
                                    onClick={() => addPassoLateral(index)} 
                                    className="wpp-step-btn"
                                    style={{ borderColor: '#8b5cf6', color: '#c4b5fd' }}
                                  >
                                    + Adicionar Passo de Fallback
                                  </button>
                                )}
                              </div>

                              {lateralAtivo && (
                                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  {(interacao.fluxo_lateral.interacoes || []).map((latInter, latIdx) => (
                                    <div key={latIdx} style={{ background: 'rgba(0,0,0,0.35)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid #8b5cf6' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#c4b5fd' }}>
                                          Fallback #{latIdx + 1}
                                        </span>
                                        <button 
                                          type="button" 
                                          onClick={() => removePassoLateral(index, latIdx)} 
                                          className="wpp-step-btn wpp-step-btn-danger"
                                          style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                                        >
                                          Remover
                                        </button>
                                      </div>

                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                                        <div>
                                          <label className="wpp-label">Se a mensagem de erro for:</label>
                                          <select 
                                            className="wpp-input"
                                            style={{ marginBottom: '6px', padding: '7px 10px', fontSize: '0.82rem' }}
                                            value={latInter.tipo_espera || 'texto_exato'}
                                            onChange={(e) => updatePassoLateral(index, latIdx, 'tipo_espera', e.target.value)}
                                          >
                                            <option value="texto_exato">Conter Texto de Erro</option>
                                            <option value="regex">Padrão Regex de Erro</option>
                                            <option value="qualquer_mensagem">Qualquer Mensagem</option>
                                          </select>
                                          <input 
                                            type="text"
                                            className="wpp-input"
                                            style={{ padding: '7px 10px', fontSize: '0.82rem' }}
                                            placeholder="Ex: CPF inválido"
                                            value={latInter.valor_espera || ''}
                                            onChange={(e) => updatePassoLateral(index, latIdx, 'valor_espera', e.target.value)}
                                          />
                                        </div>

                                        <div>
                                          <label className="wpp-label">Ação de Contorno:</label>
                                          <select 
                                            className="wpp-input"
                                            style={{ marginBottom: '6px', padding: '7px 10px', fontSize: '0.82rem' }}
                                            value={latInter.tipo_resposta}
                                            onChange={(e) => updatePassoLateral(index, latIdx, 'tipo_resposta', e.target.value)}
                                          >
                                            <option value="enviar_texto">Enviar Texto / Coluna</option>
                                            <option value="finalizar_sucesso">Encerrar Atendimento</option>
                                          </select>
                                          {latInter.tipo_resposta === 'enviar_texto' && (
                                            <input 
                                              type="text"
                                              className="wpp-input"
                                              style={{ padding: '7px 10px', fontSize: '0.82rem' }}
                                              placeholder="Ex: 0, Sair, ou coluna"
                                              value={latInter.valor_resposta || ''}
                                              onChange={(e) => updatePassoLateral(index, latIdx, 'valor_resposta', e.target.value)}
                                            />
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}

                                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '8px' }}>
                                    <label className="wpp-label" style={{ color: '#c4b5fd' }}>🎯 Ao concluir este Fallback:</label>
                                    <select 
                                      className="wpp-input"
                                      style={{ fontSize: '0.82rem', padding: '8px 10px' }}
                                      value={interacao.fluxo_lateral.acao_conclusao || 'AvancarParaProximaLinha'}
                                      onChange={(e) => updateFluxoLateral(index, 'acao_conclusao', e.target.value)}
                                    >
                                      <option value="AvancarParaProximaLinha">⏭️ Pular cliente atual e ir para a Próxima Linha da Planilha</option>
                                      <option value="ReiniciarFluxoPrincipal">🔄 Reiniciar Fluxo Principal do Passo 1</option>
                                      <option value="RepetirPassoAtual">↩️ Repetir o Passo {index + 1}</option>
                                    </select>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Barra Inferior Única: Adicionar Passo + Salvar */}
                    <div style={{ 
                      marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' 
                    }}>
                      <button 
                        type="button" 
                        onClick={addInteracao} 
                        className="wpp-btn" 
                        style={{ background: 'rgba(56, 189, 248, 0.12)', border: '1px dashed var(--primary)', color: 'var(--primary)', padding: '10px 18px' }}
                      >
                        + Adicionar Passo ({interacoes.length + 1})
                      </button>

                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {fluxoEmEdicaoId && (
                          <button type="button" onClick={cancelarEdicao} className="wpp-btn" style={{ background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}>
                            Cancelar
                          </button>
                        )}
                        <button type="submit" className="wpp-btn wpp-btn-success" style={{ padding: '11px 28px', fontSize: '0.95rem', boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)' }}>
                          💾 {fluxoEmEdicaoId ? 'Salvar Alterações' : 'Salvar Fluxo'}
                        </button>
                      </div>
                    </div>
                    <div id="fim-da-lista-interacoes" />
                  </form>
                </>
              )}
            </section>

            {/* SEÇÃO DE FLUXOS CONFIGURADOS */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Fluxos Configurados ({fluxos.length})</h2>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Baixe o modelo de planilha, suba os clientes preenchidos e inicie o disparo em lote.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <label className="wpp-btn" style={{ background: 'rgba(16, 185, 129, 0.14)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#34d399', fontSize: '0.82rem' }}>
                  📥 Importar JSON
                  <input type="file" accept=".json" style={{ display: 'none' }} onChange={importarFluxosJSON} />
                </label>
                <button 
                  onClick={exportarTodosFluxosJSON}
                  className="wpp-btn"
                  style={{ background: 'rgba(139, 92, 246, 0.14)', border: '1px solid rgba(139, 92, 246, 0.4)', color: '#c4b5fd', fontSize: '0.82rem' }}
                >
                  📤 Exportar Todos (JSON)
                </button>
              </div>
            </div>

            <div className="wpp-flows-grid">
              {fluxos.map(fluxo => {
                const upload = flowUploads[fluxo.id];
                const colunas = extractParams(fluxo.interacoes, fluxo.mensagem_inicial, fluxo.receptor);
                const isExpanded = Boolean(expandedCards[fluxo.id]);
                const passosVisiveis = isExpanded ? fluxo.interacoes : fluxo.interacoes.slice(0, 3);
                
                return (
                  <div key={fluxo.id} className="wpp-flow-card">
                    <div>
                      {/* Header do Card */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>{fluxo.nome}</h3>
                            <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: 'var(--primary)', fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px' }}>
                              {fluxo.interacoes.length} passo(s)
                            </span>
                          </div>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                            📞 Receptor: <strong style={{ color: '#e2e8f0' }}>{fluxo.receptor && fluxo.receptor !== 'Não informado' ? fluxo.receptor : 'Coluna "telefone" da planilha'}</strong>
                          </p>
                        </div>

                        <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                          <button onClick={() => exportarFluxoJSON(fluxo)} className="wpp-step-btn" title="Exportar JSON">
                            JSON
                          </button>
                          <button onClick={() => carregarFluxoParaEdicao(fluxo)} className="wpp-step-btn" style={{ color: 'var(--primary)', borderColor: 'rgba(56,189,248,0.3)' }} title="Editar fluxo">
                            ✏️ Editar
                          </button>
                          <button onClick={() => deletarFluxo(fluxo.id)} className="wpp-step-btn wpp-step-btn-danger" title="Excluir fluxo">
                            🗑️
                          </button>
                        </div>
                      </div>
                      
                      {/* Mensagem Inicial Compacta */}
                      <div style={{ background: 'rgba(56, 189, 248, 0.07)', padding: '8px 12px', borderRadius: '8px', borderLeft: '3px solid var(--primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 800, letterSpacing: '0.4px' }}>
                          🏁 GATILHO:
                        </span>
                        <code style={{ fontSize: '0.84rem', color: '#f1f5f9', fontWeight: 600 }}>&quot;{fluxo.mensagem_inicial}&quot;</code>
                      </div>
                      
                      {/* Resumo de Passos (Mostra 3 por padrão + Botão Expandir para não virar tripa!) */}
                      <div style={{ background: 'rgba(0,0,0,0.28)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        {passosVisiveis.map((i, idx) => {
                          let esperaTxt = 'Qualquer msg';
                          if (i.tipo_espera === 'multiplas_mensagens') esperaTxt = `${i.valor_espera || 'N'} msgs`;
                          else if (i.tipo_espera === 'texto_exato') esperaTxt = `"${i.valor_espera}"`;
                          else if (i.tipo_espera === 'regex') esperaTxt = `Regex`;
                          else if (i.tipo_espera === 'arquivo') esperaTxt = 'Arquivo/PDF';

                          let respTxt = '';
                          if (i.tipo_resposta === 'enviar_coluna' || (i.tipo_resposta === 'enviar_texto' && isDynamicParam(i))) {
                            respTxt = `📊 [${i.valor_resposta || 'cpf'}]`;
                          } else if (i.tipo_resposta === 'enviar_texto_fixo' || i.tipo_resposta === 'enviar_texto') {
                            respTxt = `💬 "${i.valor_resposta}"`;
                          } else if (i.tipo_resposta === 'baixar_e_continuar') {
                            respTxt = i.valor_resposta ? `📥 Baixar + "${i.valor_resposta}"` : '📥 Baixar doc';
                          } else if (i.tipo_resposta === 'finalizar_baixar') {
                            respTxt = '💾 Baixar e Finalizar';
                          } else {
                            respTxt = '🏁 Finalizar';
                          }
                          
                          return (
                            <div key={idx} style={{ fontSize: '0.8rem', padding: '5px 0', borderBottom: idx < passosVisiveis.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                              <span style={{ color: 'var(--text-muted)' }}>
                                <strong style={{ color: 'var(--primary)' }}>#{idx + 1}</strong> Se <em>{esperaTxt}</em>
                              </span>
                              <strong style={{ color: '#e2e8f0', textAlign: 'right' }}>&rarr; {respTxt}</strong>
                            </div>
                          );
                        })}

                        {fluxo.interacoes.length > 3 && (
                          <button
                            type="button"
                            onClick={() => toggleCardExpand(fluxo.id)}
                            style={{ width: '100%', marginTop: '6px', padding: '5px', background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: '6px', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                          >
                            {isExpanded ? '🔼 Ocultar passos e colunas' : `🔽 Ver todos os ${fluxo.interacoes.length} passos e ${colunas.length} colunas`}
                          </button>
                        )}
                      </div>

                      {/* Pílulas de Colunas da Planilha (Visíveis quando expandido ou se o fluxo for curto) */}
                      {(isExpanded || fluxo.interacoes.length <= 3) && (
                        <div style={{ marginTop: '12px' }}>
                          <span style={{ fontSize: '0.74rem', color: '#34d399', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                            📊 Colunas Exigidas no Excel ({colunas.length}):
                          </span>
                          <div className="wpp-pills-wrap">
                            {colunas.map((col, idx) => (
                              <div key={idx} className="wpp-col-pill" title={`Coluna: ${col}`}>
                                <span className="wpp-pill-num">{idx + 1}</span>
                                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{rotuloColuna(col)}</span>
                                <span className="wpp-pill-code">({col})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Rodapé de Operação do Card (Excel + Disparo) */}
                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {upload && (
                        <div style={{ background: upload.valido ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px', border: upload.valido ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)', fontSize: '0.8rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: upload.valido ? '#6ee7b7' : '#fca5a5', fontWeight: 700 }}>
                              {upload.valido ? '✅' : '⚠️'} {upload.fileName} ({upload.rows.length})
                            </span>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button type="button" onClick={() => setPreviewFlowId(previewFlowId === fluxo.id ? null : fluxo.id)} className="wpp-step-btn" style={{ padding: '3px 7px', fontSize: '0.7rem' }}>
                                {previewFlowId === fluxo.id ? 'Fechar' : '👁️ Prévia'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setFlowUploads(prev => { const n = { ...prev }; delete n[fluxo.id]; return n; });
                                  if (previewFlowId === fluxo.id) setPreviewFlowId(null);
                                }}
                                className="wpp-step-btn wpp-step-btn-danger"
                                style={{ padding: '3px 7px', fontSize: '0.7rem' }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          {upload.colunasFaltando.length > 0 && (
                            <div style={{ marginTop: '6px', color: '#fca5a5', fontSize: '0.74rem' }}>
                              Faltam colunas: <strong>{upload.colunasFaltando.join(', ')}</strong>
                            </div>
                          )}

                          {previewFlowId === fluxo.id && (
                            <div style={{ marginTop: '8px', overflowX: 'auto', background: 'rgba(0,0,0,0.45)', borderRadius: '6px', padding: '6px' }}>
                              <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--border)', color: '#38bdf8' }}>
                                    <th style={{ padding: '4px' }}>#</th>
                                    {upload.colunasPresentes.map((c, i) => (
                                      <th key={i} style={{ padding: '4px', whiteSpace: 'nowrap' }}>{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {upload.rows.slice(0, 3).map((r, ri) => (
                                    <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                      <td style={{ padding: '4px', color: 'var(--text-muted)' }}>{ri + 1}</td>
                                      {upload.colunasPresentes.map((c, ci) => (
                                        <td key={ci} style={{ padding: '4px', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {r[c] !== undefined && r[c] !== '' ? String(r[c]) : '-'}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button 
                          type="button"
                          onClick={() => baixarModeloExcel(fluxo)}
                          className="wpp-btn"
                          style={{ background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', color: 'var(--primary)', fontSize: '0.8rem', padding: '9px' }}
                        >
                          📥 Modelo (.xlsx)
                        </button>

                        <label className="wpp-btn" style={{ background: upload ? 'rgba(16, 185, 129, 0.15)' : 'rgba(139, 92, 246, 0.2)', border: upload ? '1px solid #10b981' : '1px solid rgba(139, 92, 246, 0.45)', color: '#fff', fontSize: '0.8rem', padding: '9px' }}>
                          {upload ? '📂 Trocar (.xlsx)' : '📤 Subir (.xlsx)'}
                          <input type="file" accept=".csv, .xlsx" style={{ display: 'none' }} onChange={(e) => handleCSVUpload(fluxo, e)} />
                        </label>
                      </div>

                      <button 
                        type="button"
                        onClick={() => iniciarExecucaoFluxoCSV(fluxo)}
                        disabled={!upload || upload.rows.length === 0}
                        className="wpp-btn wpp-btn-success"
                        style={{ 
                          width: '100%', padding: '11px', fontSize: '0.86rem',
                          opacity: (!upload || upload.rows.length === 0) ? 0.35 : 1,
                          cursor: (!upload || upload.rows.length === 0) ? 'not-allowed' : 'pointer'
                        }}
                      >
                        🚀 {upload ? `Disparar Lote (${upload.rows.length} clientes)` : 'Iniciar Lote (Suba a planilha)'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {fluxos.length === 0 && (
              <div className="wpp-panel-card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
                Nenhum fluxo configurado ainda. Utilize o editor acima para criar o seu primeiro robô!
              </div>
            )}
          </div>
        )}

        {tab === 'whatsapp' && (
          <div className="wpp-panel-card" style={{ maxWidth: '560px', margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 6px 0', color: 'var(--primary)' }}>Conectar Instância WhatsApp</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '24px' }}>
              Escaneie o QR Code abaixo no menu &quot;Aparelhos Conectados&quot; do seu WhatsApp.
            </p>

            <div style={{ background: 'rgba(0,0,0,0.35)', padding: '32px', borderRadius: '14px', border: '1px solid var(--border)', minHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {wppStatus === 'desconectado' && (
                <>
                  <div style={{ fontSize: '3rem', marginBottom: '12px', opacity: 0.6 }}>📱</div>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>O robô está desconectado no momento.</p>
                  <button onClick={gerarQrCode} className="wpp-btn wpp-btn-primary">
                    🔗 Gerar QR Code de Conexão
                  </button>
                </>
              )}

              {(wppStatus === 'gerando' || (wppStatus === 'aguardando' && !qrCodeData)) && (
                <>
                  <div style={{ width: '40px', height: '40px', border: '3px solid rgba(56, 189, 248, 0.3)', borderTop: '3px solid var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '14px' }} />
                  <p style={{ color: 'var(--primary)', fontWeight: 600 }}>Iniciando Chrome e gerando QR Code...</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '4px' }}>Isso pode levar alguns segundos. Aguarde...</p>
                  <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </>
              )}

              {wppStatus === 'aguardando' && qrCodeData && (
                <>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', marginBottom: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                    <img src={qrCodeData} alt="QR Code WhatsApp" style={{ display: 'block', width: '220px', height: '220px' }} />
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '12px' }}>Aponte a câmera do WhatsApp para o código acima.</p>
                  <button onClick={gerarQrCode} className="wpp-btn wpp-btn-outline" style={{ fontSize: '0.8rem', padding: '6px 14px' }}>
                    🔄 Atualizar QR Code
                  </button>
                </>
              )}

              {wppStatus === 'conectado' && (
                <>
                  <div style={{ fontSize: '3rem', marginBottom: '10px' }}>✅</div>
                  <h3 style={{ color: 'var(--success)', margin: '0 0 6px 0' }}>WhatsApp Conectado e Operacional!</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '0.86rem' }}>O robô está pronto para processar filas e responder mensagens.</p>
                  <button onClick={desconectarWpp} className="wpp-btn wpp-step-btn-danger">
                    Desconectar Sessão
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'execucoes' && (
          <div className="wpp-panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
              <div>
                <h2 style={{ margin: '0 0 4px 0', fontSize: '1.25rem' }}>Fila de Execuções & Logs em Tempo Real</h2>
                <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.84rem' }}>
                  Monitorização ao vivo de mensagens recebidas, regras acionadas e progresso da fila.
                </p>
              </div>
              
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button 
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/fila/exportar_resumo');
                      const data = await res.json();
                      if (!data || data.length === 0) {
                        showToast("Nenhuma execução em lote registrada ainda para exportar.", "warning");
                        return;
                      }
                      const exportData = data.map(item => ({
                        ID_Fila: item.id,
                        Telefone: item.telefone,
                        Status: item.status,
                        ...item.parametros
                      }));
                      const worksheet = XLSX.utils.json_to_sheet(exportData);
                      const workbook = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(workbook, worksheet, "Resumo_Lote");
                      XLSX.writeFile(workbook, `resumo_execucao_lote_${Date.now()}.xlsx`);
                      showToast("Relatório Excel exportado com sucesso!", "success");
                    } catch (e) {
                      showToast("Erro ao exportar resumo do lote.", "error");
                    }
                  }}
                  className="wpp-btn wpp-btn-primary"
                >
                  📊 Exportar Relatório (.xlsx)
                </button>

                <button 
                  onClick={async () => {
                    if (window.confirm("Deseja realmente PARAR o lote em andamento e cancelar todos os itens pendentes?")) {
                      try {
                        const res = await fetch('/api/fila/cancelar', { method: 'POST' });
                        const data = await res.json();
                        showToast(`Processo interrompido! ${data.itens_cancelados} item(ns) cancelado(s).`, "warning");
                      } catch (e) {
                        showToast("Erro ao cancelar o lote.", "error");
                      }
                    }
                  }}
                  className="wpp-btn wpp-step-btn-danger"
                >
                  🛑 Parar Fila em Lote
                </button>

                <button 
                  onClick={async () => {
                    if (window.confirm("Deseja limpar todo o histórico de logs da tela?")) {
                      try {
                        await fetch('/api/logs/limpar', { method: 'POST' });
                        setLogs([]);
                        showToast("Histórico de logs limpo.", "info");
                      } catch (e) {
                        showToast("Erro ao limpar logs.", "error");
                      }
                    }
                  }}
                  className="wpp-btn"
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}
                >
                  🧹 Limpar Console
                </button>
              </div>
            </div>
            
            <div style={{ background: '#05080f', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', fontFamily: 'monospace', maxHeight: '540px', overflowY: 'auto' }}>
              {logs.length > 0 ? (
                logs.map(log => (
                  <div key={log.id} style={{ marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.82rem', flexWrap: 'wrap' }}>
                      <span style={{ color: '#64748b' }}>[{log.timestamp}]</span>
                      <span style={{ color: log.nivel === 'INFO' ? 'var(--primary)' : log.nivel === 'WARN' ? '#fde047' : 'var(--danger)', fontWeight: 700 }}>[{log.nivel}]</span>
                      <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{log.mensagem}</span>
                    </div>
                    {Object.keys(log.detalhes || {}).length > 0 && (
                      <pre style={{ margin: '6px 0 0 12px', fontSize: '0.76rem', color: '#94a3b8', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '6px', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(log.detalhes, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '36px 0', margin: 0 }}>
                  Nenhum evento registrado no console ainda.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* MODAL DO WIZARD */}
      {wizardAberto && (
        <div 
          onClick={fecharWizard}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 90
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#111827', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '18px',
              width: '100%', maxWidth: '720px', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 48px rgba(0,0,0,0.6)', overflow: 'hidden'
            }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ color: 'var(--primary)', margin: 0, fontSize: '1.1rem' }}>🧙 Assistente Guiado de Fluxo</h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Etapa {wizardPasso + 1} de {WIZARD_PASSOS.length} · {WIZARD_PASSOS[wizardPasso]}
                </span>
              </div>
              <button type="button" onClick={fecharWizard} className="wpp-step-btn">✕</button>
            </div>

            <div style={{ padding: '22px', overflowY: 'auto', flex: 1 }}>
              {wizardPasso === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label className="wpp-label">Nome do Fluxo *</label>
                    <input
                      type="text"
                      className="wpp-input"
                      placeholder="Ex: Consulta CNPJ Prefeitura"
                      value={wizardDados.nome}
                      onChange={(e) => atualizarWizardDados('nome', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="wpp-label">Telefone do Robô Receptor (Opcional)</label>
                    <input
                      type="text"
                      className="wpp-input"
                      placeholder="Ex: 5511999999999"
                      value={wizardDados.receptor}
                      onChange={(e) => atualizarWizardDados('receptor', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="wpp-label" style={{ color: 'var(--primary)' }}>Mensagem Inicial (Gatilho) *</label>
                    <input
                      type="text"
                      className="wpp-input"
                      placeholder="Ex: Oi, gostaria de consultar o CNPJ"
                      value={wizardDados.mensagemInicial}
                      onChange={(e) => atualizarWizardDados('mensagemInicial', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {wizardPasso === 1 && (
                <div>
                  {wizardDados.interacoes.map((interacao, index) => (
                    <div key={index} className="wpp-step-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '0.85rem' }}>Passo {index + 1}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button type="button" className="wpp-step-btn" disabled={index === 0} onClick={() => moverWizardInteracao(index, -1)}>↑</button>
                          <button type="button" className="wpp-step-btn" disabled={index === wizardDados.interacoes.length - 1} onClick={() => moverWizardInteracao(index, 1)}>↓</button>
                          {wizardDados.interacoes.length > 1 && (
                            <button type="button" className="wpp-step-btn wpp-step-btn-danger" onClick={() => removerWizardInteracao(index)}>Remover</button>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label className="wpp-label">1. O que esperar?</label>
                          <select
                            className="wpp-input"
                            value={interacao.tipo_espera}
                            onChange={(e) => atualizarWizardInteracao(index, 'tipo_espera', e.target.value)}
                            style={{ marginBottom: '6px' }}
                          >
                            {WIZARD_OPCOES_ESPERA.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                          {(interacao.tipo_espera === 'texto_exato' || interacao.tipo_espera === 'regex' || interacao.tipo_espera === 'multiplas_mensagens') && (
                            <input
                              type={interacao.tipo_espera === 'multiplas_mensagens' ? 'number' : 'text'}
                              min={interacao.tipo_espera === 'multiplas_mensagens' ? '2' : undefined}
                              className="wpp-input"
                              placeholder="Valor esperado..."
                              value={interacao.valor_espera}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_espera', e.target.value)}
                            />
                          )}
                        </div>

                        <div>
                          <label className="wpp-label">2. Qual a ação?</label>
                          <select
                            className="wpp-input"
                            value={
                              interacao.tipo_resposta === 'enviar_texto'
                                ? (isDynamicParam(interacao) ? 'enviar_coluna' : 'enviar_texto_fixo')
                                : interacao.tipo_resposta
                            }
                            onChange={(e) => atualizarWizardInteracao(index, 'tipo_resposta', e.target.value)}
                            style={{ marginBottom: '6px' }}
                          >
                            {WIZARD_OPCOES_RESPOSTA.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>

                          {(interacao.tipo_resposta === 'enviar_texto_fixo' || (interacao.tipo_resposta === 'enviar_texto' && !isDynamicParam(interacao))) && (
                            <input
                              type="text"
                              className="wpp-input"
                              placeholder="Texto fixo (Ex: 1, Financeiro)"
                              value={interacao.valor_resposta}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_resposta', e.target.value)}
                            />
                          )}

                          {(interacao.tipo_resposta === 'enviar_coluna' || (interacao.tipo_resposta === 'enviar_texto' && isDynamicParam(interacao))) && (
                            <input
                              type="text"
                              className="wpp-input"
                              style={{ borderColor: '#10b981' }}
                              placeholder="Coluna (Ex: cpf, cnpj)"
                              value={interacao.valor_resposta}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_resposta', e.target.value)}
                            />
                          )}

                          {interacao.tipo_resposta === 'baixar_e_continuar' && (
                            <input
                              type="text"
                              className="wpp-input"
                              placeholder="Texto opcional após baixar"
                              value={interacao.valor_resposta}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_resposta', e.target.value)}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={adicionarWizardInteracao} className="wpp-btn wpp-btn-primary" style={{ fontSize: '0.82rem' }}>
                    + Adicionar Interação
                  </button>
                </div>
              )}

              {wizardPasso === 2 && (
                <div>
                  <div style={{ background: 'rgba(56, 189, 248, 0.08)', padding: '14px', borderRadius: '10px', borderLeft: '3px solid var(--primary)', marginBottom: '16px', fontSize: '0.88rem' }}>
                    <div style={{ marginBottom: '4px' }}><strong>Nome:</strong> {wizardDados.nome}</div>
                    <div style={{ marginBottom: '4px' }}><strong>Receptor:</strong> {wizardDados.receptor || 'Pela planilha'}</div>
                    <div><strong>Mensagem Inicial:</strong> &quot;{wizardDados.mensagemInicial}&quot;</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {wizardDados.interacoes.map((i, idx) => (
                      <div key={idx} style={{ background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem' }}>
                        <strong style={{ color: 'var(--primary)' }}>Passo {idx + 1}:</strong> Se <em>{descreverEsperaWizard(i)}</em> &rarr; <strong>{descreverRespostaWizard(i)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" className="wpp-step-btn" onClick={fecharWizard}>Cancelar</button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="wpp-step-btn"
                  disabled={wizardPasso === 0}
                  onClick={() => setWizardPasso((p) => Math.max(0, p - 1))}
                >
                  ← Voltar
                </button>
                {wizardPasso < WIZARD_PASSOS.length - 1 ? (
                  <button type="button" className="wpp-btn wpp-btn-primary" onClick={avancarWizard}>
                    Avançar →
                  </button>
                ) : (
                  <button type="button" className="wpp-btn wpp-btn-success" onClick={aplicarWizard}>
                    ✅ Aplicar ao Editor
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
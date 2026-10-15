import React, { useState } from 'react';
import * as XLSX from 'xlsx';

// Passos do Wizard (assistente de criação de interações).
// Puramente aditivo: não altera nenhuma forma atual de configuração do editor.
const WIZARD_PASSOS = ['Identificação', 'Interações', 'Revisão'];

// Opções de espera/ação do wizard - espelham exatamente as usadas pelo editor atual
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
  
  // Para tipo_resposta === 'enviar_texto' (retrocompatibilidade):
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

const OPCOES_RESPOSTA = [
  { value: 'enviar_texto_fixo', label: '💬 Enviar Texto Fixo (Menu / Opção Fixa)' },
  { value: 'enviar_coluna', label: '📊 Enviar Dado da Planilha (Variável por Cliente)' },
  { value: 'baixar_e_continuar', label: '📥 Baixar Arquivo e Continuar Fluxo' },
  { value: 'finalizar_sucesso', label: '🏁 Finalizar Fluxo com Sucesso' },
  { value: 'finalizar_baixar', label: '💾 Finalizar e Baixar Arquivo' }
];

const WIZARD_OPCOES_RESPOSTA = [
  { value: 'enviar_texto_fixo', label: '💬 Enviar Texto Fixo (Menu / Opção Fixa)' },
  { value: 'enviar_coluna', label: '📊 Enviar Dado da Planilha (Variável por Cliente)' },
  { value: 'baixar_e_continuar', label: '📥 Baixar Arquivo e Continuar Fluxo' },
  { value: 'finalizar_sucesso', label: '🏁 Finalizar Fluxo com Sucesso' },
  { value: 'finalizar_baixar', label: '💾 Finalizar e Baixar Arquivo' }
];

// Converte o nome técnico da coluna em rótulo legível (ex: passo_2_financeiro -> "Passo 2 · financeiro")
export const rotuloColuna = (col) => {
  if (col === 'mensagem_inicial') return 'Mensagem inicial';
  if (col === 'telefone') return 'Telefone destino';
  const m = /^passo_(\d+)_?(.*)$/.exec(col);
  if (m) return m[2] ? `Passo ${m[1]} · ${m[2].replace(/_+/g, ' ').trim()}` : `Passo ${m[1]}`;
  return col;
};

// Detecta sequências de passos "Qualquer mensagem" (risco de dessincronia com o robô do outro lado)
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

  const [novoFluxoNome, setNovoFluxoNome] = useState('');
  const [novoReceptor, setNovoReceptor] = useState('');
  const [novaMensagemInicial, setNovaMensagemInicial] = useState('');

  // Wizard (modal assistente) - estado próprio, não afeta o editor até o usuário confirmar
  const [wizardAberto, setWizardAberto] = useState(false);
  const [wizardPasso, setWizardPasso] = useState(0);
  // Rascunho isolado do wizard - só é aplicado ao editor no passo de revisão (confirmar)
  const [wizardDados, setWizardDados] = useState({
    nome: '',
    receptor: '',
    mensagemInicial: '',
    interacoes: [{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]
  });
  
  // WPP Connection state
  const [wppStatus, setWppStatus] = useState('desconectado'); // desconectado, gerando, aguardando, conectado
  const [qrCodeData, setQrCodeData] = useState(null);
  
  // Toast notification state
  const [toast, setToast] = useState(null); // { message: '', type: 'info' | 'success' | 'warning' | 'error' }
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // CSV / XLSX Lote State por Fluxo (isolado para não vazar entre cards)
  const [flowUploads, setFlowUploads] = useState({});
  const [previewFlowId, setPreviewFlowId] = useState(null);

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
        
        // Converte a planilha em objetos JSON
        const rawJsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        if (!rawJsonData || rawJsonData.length === 0) {
          showToast("A planilha deve conter o cabeçalho e pelo menos uma linha de dados.", "error");
          return;
        }

        // Limpa chaves e valores removendo espaços extras e \r
        const data = rawJsonData.map(row => {
          let cleanRow = {};
          Object.keys(row).forEach(k => {
            const cleanKey = k.trim().replace(/\r/g, '');
            const cleanVal = typeof row[k] === 'string' ? row[k].trim().replace(/\r/g, '') : String(row[k]);
            cleanRow[cleanKey] = cleanVal;
          });
          return cleanRow;
        });

        // Validação de colunas esperadas pelo fluxo
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
    e.target.value = null; // reset
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
          const res = await fetch('http://localhost:3001/api/wpp/status');
          const data = await res.json();
          setWppStatus(data.status);
          setQrCodeData(data.qr);
        } catch (e) {
          console.error("Erro ao checar status do WPP", e);
        }
      };
      fetchStatus();
      interval = setInterval(fetchStatus, 3000);
    }
    return () => clearInterval(interval);
  }, [tab]);

  // Dynamic rules state with structured objects
  const [interacoes, setInteracoes] = useState([
    { 
      tipo_espera: 'qualquer_mensagem', 
      valor_espera: '', 
      tipo_resposta: 'enviar_texto', 
      valor_resposta: '' 
    }
  ]);

  const [logs, setLogs] = useState([]);

  // Fetch logs on interval when in execucoes tab
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
    
    // Se o receptor não for fixo, a primeira coluna da planilha é o telefone do destinatário
    if (!receptor || receptor === 'Não informado' || !receptor.trim()) {
      params.push("telefone");
    }

    // Mensagem inicial ("Ola")
    params.push("mensagem_inicial");

    // Exatamente uma coluna para cada interação/passo do fluxo
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
    
    // Auto-clear values when switching types
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
    console.log("chamou")
    try {
      console.log('foi pro try')
      new RegExp(regex);
      return true;
    } catch (e) {
      console.log("foi pro catch")
      alert("Regex inválida: " + e.message);
      return false;

    }
  };

  // Load fluxos on mount
  React.useEffect(() => {
    fetch('/api/fluxos')
      .then(res => res.json())
      .then(data => setFluxos(data))
      .catch(err => console.error("Erro ao carregar fluxos:", err));
  }, []);

  const [fluxoEmEdicaoId, setFluxoEmEdicaoId] = useState(null);

  const carregarFluxoParaEdicao = (fluxo) => {
    setFluxoEmEdicaoId(fluxo.id);
    setNovoFluxoNome(fluxo.nome || '');
    setNovoReceptor(fluxo.receptor === 'Não informado' ? '' : (fluxo.receptor || ''));
    setNovaMensagemInicial(fluxo.mensagem_inicial || '');
    setInteracoes(fluxo.interacoes && fluxo.interacoes.length > 0 ? fluxo.interacoes : [{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelarEdicao = () => {
    setFluxoEmEdicaoId(null);
    setNovoFluxoNome('');
    setNovoReceptor('');
    setNovaMensagemInicial('');
    setInteracoes([{ tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]);
  };

  // Wizard (modal assistente) - aditivo. Abrir/fechar NÃO altera o editor atual.
  const abrirWizard = () => {
    // Pré-preenche o rascunho com os dados atuais do editor (apenas LEITURA - não altera o editor)
    setWizardDados({
      nome: novoFluxoNome || '',
      receptor: novoReceptor === 'Não informado' ? '' : (novoReceptor || ''),
      mensagemInicial: novaMensagemInicial || '',
      // Clona as interações atuais do editor (LEITURA) para o rascunho do wizard
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
      // Mesmo comportamento do editor atual: limpa valores ao trocar de tipo
      if (field === 'tipo_espera' && (value === 'qualquer_mensagem' || value === 'arquivo')) {
        novas[index].valor_espera = '';
      }
      if (field === 'tipo_resposta' && value !== 'enviar_texto' && value !== 'baixar_e_continuar') {
        novas[index].valor_resposta = '';
      }
      return { ...prev, interacoes: novas };
    });
  };

  const adicionarWizardInteracao = () => {
    setWizardDados((prev) => ({
      ...prev,
      interacoes: [...prev.interacoes, { tipo_espera: 'qualquer_mensagem', valor_espera: '', tipo_resposta: 'enviar_texto', valor_resposta: '' }]
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

  // --- Wizard: revisão, validação e aplicação (Subproblemas 4 e 5) ---
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
    // Aplica o rascunho no editor; a persistência continua sendo feita pelo botão "Salvar Fluxo"
    setNovoFluxoNome(wizardDados.nome.trim());
    setNovoReceptor(wizardDados.receptor.trim());
    setNovaMensagemInicial(wizardDados.mensagemInicial.trim());
    setInteracoes(wizardDados.interacoes.map((i) => ({ ...i })));
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

          // Garante ID único caso seja um novo fluxo ou mantenha o id se fornecido
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
    e.target.value = null; // reset input
  };

  const gerarQrCode = async () => {
    setWppStatus('gerando');
    try {
      await fetch('http://localhost:3001/api/wpp/connect', { method: 'POST' });
    } catch (e) {
      console.error(e);
      setWppStatus('desconectado');
    }
  };

  const desconectarWpp = async () => {
    try {
      await fetch('http://localhost:3001/api/wpp/disconnect', { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
    setWppStatus('desconectado');
    setQrCodeData(null);
  };

  return (
    <div className="app-container">
      {/* Toast flutuante de feedback */}
      {toast && (
        <div className={`toast-notification toast-${toast.type || 'info'}`}>
          <span>
            {toast.type === 'success' && '✅ '}
            {toast.type === 'error' && '❌ '}
            {toast.type === 'warning' && '⚠️ '}
            {toast.type === 'info' && 'ℹ️ '}
            {toast.message}
          </span>
          <button onClick={() => setToast(null)} className="toast-close" title="Fechar">&times;</button>
        </div>
      )}

      <header>
        <div>
          <h1 className="logo-title">Orquestrador WPP</h1>
          <p className="subtitle">Painel de Gestão de Automações & Regras</p>
        </div>
        <nav className="nav-tabs">
          <button 
            className={`tab-btn ${tab === 'fluxos' ? 'active' : ''}`}
            onClick={() => setTab('fluxos')}
          >
            🧩 Fluxos & Regras
          </button>
          <button 
            className={`tab-btn ${tab === 'whatsapp' ? 'active' : ''}`}
            onClick={() => setTab('whatsapp')}
          >
            📱 Conexão WhatsApp
          </button>
          <button 
            className={`tab-btn ${tab === 'execucoes' ? 'active' : ''}`}
            onClick={() => setTab('execucoes')}
          >
            ⚡ Execuções & Logs
          </button>
        </nav>
      </header>

      <main>
        {tab === 'fluxos' && (
          <div>
            <section className="glass-card">
              <h2 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>
                {fluxoEmEdicaoId ? `✏️ Editando Fluxo: ${novoFluxoNome}` : '✨ Criar Novo Fluxo de Automação'}
              </h2>
              {fluxoEmEdicaoId && (
                <div style={{ marginBottom: '1rem', background: 'rgba(234, 179, 8, 0.1)', padding: '0.8rem', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#fde047', fontSize: '0.9rem' }}>Modo de edição ativo. Altere os dados abaixo e clique em Salvar Alterações.</span>
                  <button type="button" onClick={cancelarEdicao} className="btn" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.8rem', padding: '0.3rem 0.8rem' }}>Cancelar Edição</button>
                </div>
              )}
              <form onSubmit={criarFluxo}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
                    <label className="form-label">Nome do Fluxo</label>
                    <input 
                      type="text" 
                      className="form-input"
                      placeholder="Ex: Consulta CNPJ Prefeitura" 
                      value={novoFluxoNome}
                      onChange={(e) => setNovoFluxoNome(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
                    <label className="form-label">Telefone do Robô Receptor</label>
                    <input 
                      type="text" 
                      className="form-input"
                      placeholder="Ex: 5511999999999" 
                      value={novoReceptor}
                      onChange={(e) => setNovoReceptor(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ background: 'rgba(56, 189, 248, 0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                  <label className="form-label" style={{ color: 'var(--primary)' }}>Mensagem Inicial (Gatilho)</label>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    Qual é a primeira mensagem que o nosso robô deve enviar para iniciar a conversa?
                  </p>
                  <input 
                    type="text" 
                    className="form-input"
                    placeholder="Ex: Oi, gostaria de consultar o CNPJ" 
                    value={novaMensagemInicial}
                    onChange={(e) => setNovaMensagemInicial(e.target.value)}
                    required
                  />
                </div>

                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <div>
                      <h3 style={{ color: 'var(--text-main)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        🪜 Sequência de Passos do Atendimento
                      </h3>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.2rem 0 0 0' }}>
                        Cada passo define o que o robô espera receber e qual ação tomará em seguida.
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button type="button" onClick={abrirWizard} className="btn" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', background: 'rgba(139, 92, 246, 0.2)', border: '1px solid #8b5cf6', color: '#a78bfa' }} title="Abrir assistente guiado para montar o fluxo">
                        🧙 Assistente Wizard
                      </button>
                      <button type="button" onClick={addInteracao} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                        ➕ Adicionar Passo
                      </button>
                    </div>
                  </div>

                  {/* Alerta de Passos Cegos Consecutivos */}
                  {contarPassosCegosSeguidos(interacoes) >= 3 && (
                    <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#fcd34d', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>⚠️</span>
                      <div>
                        <strong>Atenção ao risco de dessincronização:</strong> Há {contarPassosCegosSeguidos(interacoes)} passos seguidos configurados como "Qualquer Mensagem". Se a outra ponta (ex: URA ou robô) enviar 2 mensagens seguidas (como boas-vindas ou propaganda), o robô responderá cedo demais. Recomenda-se usar <em>"Aguardar Múltiplas Mensagens"</em> ou <em>"Conter um Texto Específico"</em>.
                      </div>
                    </div>
                  )}
                  
                  <div className="rules-container">
                    {interacoes.map((interacao, index) => (
                      <div className="rule-item" key={index} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#fff', background: 'var(--primary)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                              Passo {index + 1}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              {interacao.tipo_resposta === 'enviar_coluna' || (interacao.tipo_resposta === 'enviar_texto' && isDynamicParam(interacao))
                                ? '📊 Envia dado da planilha'
                                : interacao.tipo_resposta === 'baixar_e_continuar'
                                ? '📥 Baixa arquivo e continua'
                                : interacao.tipo_resposta === 'finalizar_sucesso' || interacao.tipo_resposta === 'finalizar_baixar'
                                ? '🏁 Encerramento do fluxo'
                                : '💬 Envia texto padrão'}
                            </span>
                          </div>

                          <div className="step-actions">
                            <button 
                              type="button" 
                              onClick={() => moveInteracao(index, -1)} 
                              disabled={index === 0}
                              className="step-btn" 
                              title="Mover este passo para cima na sequência"
                            >
                              ⬆️ Subir
                            </button>
                            <button 
                              type="button" 
                              onClick={() => moveInteracao(index, 1)} 
                              disabled={index === interacoes.length - 1}
                              className="step-btn" 
                              title="Mover este passo para baixo na sequência"
                            >
                              ⬇️ Descer
                            </button>
                            <button 
                              type="button" 
                              onClick={() => duplicarInteracao(index)} 
                              className="step-btn" 
                              title="Duplicar este passo"
                            >
                              📋 Duplicar
                            </button>
                            {interacoes.length > 1 && (
                              <button 
                                type="button" 
                                onClick={() => removeInteracao(index)} 
                                className="step-btn step-btn-danger" 
                                title="Excluir este passo do fluxo"
                              >
                                🗑️ Remover
                              </button>
                            )}
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                          {/* Coluna da Espera */}
                          <div style={{ flex: 1, minWidth: '250px', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '6px' }}>
                            <label className="form-label" style={{ color: '#cbd5e1' }}>1. O que o robô deve esperar?</label>
                            <select 
                              className="form-input" 
                              value={interacao.tipo_espera}
                              onChange={(e) => updateInteracao(index, 'tipo_espera', e.target.value)}
                              style={{ marginBottom: interacao.tipo_espera !== 'qualquer_mensagem' && interacao.tipo_espera !== 'arquivo' ? '0.4rem' : '0', color: 'var(--text-main)' }}
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
                                className="form-input" 
                                placeholder={
                                  interacao.tipo_espera === 'texto_exato' ? 'Ex: Digite seu CPF' : 
                                  interacao.tipo_espera === 'regex' ? 'Ex: ^[0-9]{11}$' : 'Qtd de mensagens a esperar (ex: 3)'
                                }
                                value={interacao.valor_espera}
                                onChange={(e) => updateInteracao(index, 'valor_espera', e.target.value)}
                                onBlur={(e)=> interacao.tipo_espera === 'regex' && validateRegex(e.target.value)}
                                required
                              />
                            )}
                          </div>

                          {/* Coluna da Resposta */}
                          <div style={{ flex: 1, minWidth: '250px', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '6px' }}>
                            <label className="form-label" style={{ color: '#cbd5e1' }}>2. Qual será a ação do robô?</label>
                            <select 
                              className="form-input" 
                              value={
                                interacao.tipo_resposta === 'enviar_texto'
                                  ? (isDynamicParam(interacao) ? 'enviar_coluna' : 'enviar_texto_fixo')
                                  : interacao.tipo_resposta
                              }
                              onChange={(e) => updateInteracao(index, 'tipo_resposta', e.target.value)}
                              style={{ marginBottom: '0.4rem', color: 'var(--text-main)' }}
                            >
                              <option value="enviar_texto_fixo">💬 Enviar Texto Padrão (Menu / Opção)</option>
                              <option value="enviar_coluna">📊 Enviar Dado da Planilha (Variável por Cliente)</option>
                              <option value="baixar_e_continuar">📥 Baixar Arquivo e Continuar Fluxo</option>
                              <option value="finalizar_sucesso">🏁 Finalizar Fluxo com Sucesso</option>
                              <option value="finalizar_baixar">💾 Finalizar e Baixar Arquivo</option>
                            </select>
                            
                            {/* Input para Texto Padrão */}
                            {(interacao.tipo_resposta === 'enviar_texto_fixo' || (interacao.tipo_resposta === 'enviar_texto' && !isDynamicParam(interacao))) && (
                              <div>
                                <input 
                                  type="text" 
                                  className="form-input" 
                                  placeholder="Texto exato que o robô vai enviar (Ex: 1, Financeiro, Sim, Sair)"
                                  value={interacao.valor_resposta}
                                  onChange={(e) => updateInteracao(index, 'valor_resposta', e.target.value)}
                                  required
                                />
                                <span style={{ fontSize: '0.75rem', color: '#93c5fd', display: 'block', marginTop: '0.3rem' }}>
                                  📋 <strong>Planilha Excel:</strong> gera a coluna <code>{`passo_${index + 1}${interacao.valor_resposta ? '_' + interacao.valor_resposta.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15) : ''}`}</code> pré-preenchida com este texto (pode ser customizada por cliente).
                                </span>
                              </div>
                            )}

                            {/* Input para Coluna da Planilha */}
                            {(interacao.tipo_resposta === 'enviar_coluna' || (interacao.tipo_resposta === 'enviar_texto' && isDynamicParam(interacao))) && (
                              <div>
                                <input 
                                  type="text" 
                                  className="form-input" 
                                  style={{ border: '1px solid #10b981', background: 'rgba(16, 185, 129, 0.08)' }}
                                  placeholder="Nome da coluna da planilha (Ex: cpf, cnpj, telefone)"
                                  value={interacao.valor_resposta}
                                  onChange={(e) => updateInteracao(index, 'valor_resposta', e.target.value)}
                                  required
                                />
                                <span style={{ fontSize: '0.75rem', color: '#86efac', display: 'block', marginTop: '0.3rem', fontWeight: 'bold' }}>
                                  📊 <strong>Dado Variável:</strong> gera a coluna <code>{`passo_${index + 1}${interacao.valor_resposta ? '_' + interacao.valor_resposta.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15) : ''}`}</code> na planilha para preenchimento individual de cada lead.
                                </span>
                              </div>
                            )}

                            {/* Input para Baixar e Continuar */}
                            {interacao.tipo_resposta === 'baixar_e_continuar' && (
                              <div>
                                <input 
                                  type="text" 
                                  className="form-input" 
                                  placeholder="Texto opcional a enviar após baixar (Ex: Sair)"
                                  value={interacao.valor_resposta}
                                  onChange={(e) => updateInteracao(index, 'valor_resposta', e.target.value)}
                                />
                                <span style={{ fontSize: '0.75rem', color: '#93c5fd', display: 'block', marginTop: '0.3rem' }}>
                                  📥 Salva o arquivo na pasta de downloads e envia este texto (se preenchido).
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Bloco de Fluxo Lateral / Subfluxo de Desvio Recursivo */}
                        <div style={{ marginTop: '0.75rem', background: 'rgba(239, 68, 68, 0.08)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'bold', color: '#fca5a5', fontSize: '0.85rem' }}>
                              <input 
                                type="checkbox"
                                checked={interacao.fluxo_lateral?.ativo || false}
                                onChange={(e) => updateFluxoLateral(index, 'ativo', e.target.checked)}
                              />
                              🔀 Ativar Fluxo Lateral (Subfluxo Completo de Desvio / Fallback)
                            </label>

                            {interacao.fluxo_lateral?.ativo && (
                              <button 
                                type="button" 
                                onClick={() => addPassoLateral(index)} 
                                className="btn btn-primary" 
                                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                              >
                                + Adicionar Passo Lateral
                              </button>
                            )}
                          </div>

                          {interacao.fluxo_lateral?.ativo && (
                            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              <p style={{ fontSize: '0.8rem', color: '#fda4af', margin: 0 }}>
                                Se a condição do Passo {index + 1} falhar, o atendimento entrará neste <strong>Subfluxo Lateral</strong> (com 1 ou mais passos) para responder e tratar a exceção:
                              </p>

                              {/* Passos do Subfluxo Lateral */}
                              {(interacao.fluxo_lateral.interacoes || []).map((latInter, latIdx) => (
                                <div key={latIdx} style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '6px', borderLeft: '3px solid #f43f5e' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#fda4af' }}>
                                      Passo Lateral {latIdx + 1}
                                    </span>
                                    <button 
                                      type="button" 
                                      onClick={() => removePassoLateral(index, latIdx)} 
                                      className="btn btn-danger" 
                                      style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem' }}
                                    >
                                      Remover
                                    </button>
                                  </div>

                                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '200px' }}>
                                      <label style={{ fontSize: '0.75rem', color: '#cbd5e1', display: 'block', marginBottom: '0.2rem' }}>Espera (Subfluxo):</label>
                                      <select 
                                        className="form-input"
                                        style={{ fontSize: '0.8rem', padding: '0.3rem' }}
                                        value={latInter.tipo_espera || 'texto_exato'}
                                        onChange={(e) => updatePassoLateral(index, latIdx, 'tipo_espera', e.target.value)}
                                      >
                                        <option value="texto_exato">Conter Texto Fixo de Erro</option>
                                        <option value="regex">Expressão Regular (Regex) de Erro</option>
                                        <option value="qualquer_mensagem">Qualquer Mensagem de Erro</option>
                                      </select>
                                      <input 
                                        type="text"
                                        className="form-input"
                                        style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}
                                        placeholder={latInter.tipo_espera === 'regex' ? 'Regex de erro (Ex: .*(inválido|reiniciar).*)' : 'Texto de erro (Ex: Digite 0 para reiniciar)'}
                                        value={latInter.valor_espera || ''}
                                        onChange={(e) => updatePassoLateral(index, latIdx, 'valor_espera', e.target.value)}
                                      />
                                    </div>

                                    <div style={{ flex: 1, minWidth: '200px' }}>
                                      <label style={{ fontSize: '0.75rem', color: '#cbd5e1', display: 'block', marginBottom: '0.2rem' }}>Resposta (Subfluxo):</label>
                                      <select 
                                        className="form-input"
                                        style={{ fontSize: '0.8rem', padding: '0.3rem' }}
                                        value={latInter.tipo_resposta}
                                        onChange={(e) => updatePassoLateral(index, latIdx, 'tipo_resposta', e.target.value)}
                                      >
                                        <option value="enviar_texto">Enviar Texto Direto / Valor da Coluna</option>
                                        <option value="finalizar_sucesso">Concluir Subfluxo</option>
                                      </select>
                                      {latInter.tipo_resposta === 'enviar_texto' && (
                                        <input 
                                          type="text"
                                          className="form-input"
                                          style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}
                                          placeholder="Texto direto a enviar (Ex: opcao1, 0, Reiniciar) ou nome da coluna"
                                          value={latInter.valor_resposta || ''}
                                          onChange={(e) => updatePassoLateral(index, latIdx, 'valor_resposta', e.target.value)}
                                        />
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}

                              {/* Ação ao Concluir o Subfluxo Lateral */}
                              <div style={{ marginTop: '0.4rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px' }}>
                                <label style={{ fontSize: '0.8rem', color: '#fca5a5', fontWeight: 'bold', display: 'block', marginBottom: '0.3rem' }}>
                                  🎯 Ação ao Concluir este Subfluxo Lateral:
                                </label>
                                <select 
                                  className="form-input"
                                  style={{ fontSize: '0.85rem' }}
                                  value={interacao.fluxo_lateral.acao_conclusao || 'AvancarParaProximaLinha'}
                                  onChange={(e) => updateFluxoLateral(index, 'acao_conclusao', e.target.value)}
                                >
                                  <option value="AvancarParaProximaLinha">⏭️ Encerrar linha atual e Avançar para a Próxima Linha da Planilha</option>
                                  <option value="ReiniciarFluxoPrincipal">🔄 Reiniciar Fluxo Principal a partir do Passo 1 (mesma linha)</option>
                                  <option value="RepetirPassoAtual">↩️ Tentar novamente o mesmo passo do Fluxo Principal</option>
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Barra de Ação Inferior: Adicionar Novo Passo na parte de baixo */}
                  <div style={{ 
                    marginTop: '1.25rem', 
                    padding: '1.25rem', 
                    background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)', 
                    borderRadius: '8px', 
                    border: '2px dashed rgba(56, 189, 248, 0.35)',
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    flexWrap: 'wrap', 
                    gap: '1rem' 
                  }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button 
                        type="button" 
                        onClick={addInteracao} 
                        className="btn btn-primary" 
                        style={{ padding: '0.8rem 1.6rem', fontSize: '1.05rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 14px rgba(56, 189, 248, 0.4)' }}
                        title="Adicionar um novo passo diretamente ao final do fluxo"
                      >
                        ➕ Adicionar Novo Passo Aqui
                      </button>
                      <button 
                        type="button" 
                        onClick={abrirWizard} 
                        className="btn" 
                        style={{ padding: '0.8rem 1.25rem', fontSize: '0.9rem', background: 'rgba(139, 92, 246, 0.25)', border: '1px solid #8b5cf6', color: '#c4b5fd', fontWeight: '600' }}
                      >
                        🧙 Abrir Wizard
                      </button>
                    </div>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      Total: <strong>{interacoes.length}</strong> passo(s) configurado(s)
                    </span>
                  </div>
                  <div id="fim-da-lista-interacoes" />

                </div>

                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center' }}>
                  {fluxoEmEdicaoId && (
                    <button type="button" onClick={cancelarEdicao} className="btn" style={{ padding: '0.9rem 1.8rem', background: 'rgba(255,255,255,0.1)', color: '#cbd5e1' }}>
                      Cancelar Edição
                    </button>
                  )}
                  <button type="submit" className="btn btn-success" style={{ padding: '0.9rem 2.5rem', fontSize: '1.1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 16px rgba(16, 185, 129, 0.4)' }}>
                    💾 Salvar Fluxo
                  </button>
                </div>
              </form>
            </section>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <h2 style={{ margin: 0 }}>Fluxos Configurados</h2>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <label className="btn" style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#10b981', cursor: 'pointer', padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                  📥 Importar JSON
                  <input type="file" accept=".json" style={{ display: 'none' }} onChange={importarFluxosJSON} />
                </label>
                <button 
                  onClick={exportarTodosFluxosJSON}
                  className="btn"
                  style={{ background: 'rgba(99, 102, 241, 0.2)', border: '1px solid #6366f1', color: '#818cf8', cursor: 'pointer', padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                  title="Exportar todos os fluxos configurados num único arquivo JSON"
                >
                  📤 Exportar Todos (JSON)
                </button>
              </div>
            </div>
            <div className="grid-cards">
              {fluxos.map(fluxo => {
                const upload = flowUploads[fluxo.id];
                const colunas = extractParams(fluxo.interacoes, fluxo.mensagem_inicial, fluxo.receptor);
                
                return (
                  <div key={fluxo.id} className="flow-card">
                    {/* Header do Card */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <h3 className="flow-title" style={{ margin: 0, fontSize: '1.15rem' }}>{fluxo.nome}</h3>
                          <span className="flow-badge">{fluxo.interacoes.length} passo(s)</span>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                          Receptor Fixo: <strong style={{ color: '#e2e8f0' }}>{fluxo.receptor || 'Não informado (usará coluna telefone)'}</strong>
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                        <button 
                          onClick={() => exportarFluxoJSON(fluxo)}
                          style={{ background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.4)', color: '#a5b4fc', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          title="Exportar este fluxo em JSON"
                        >
                          💾 JSON
                        </button>
                        <button 
                          onClick={() => carregarFluxoParaEdicao(fluxo)}
                          style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.4)', color: 'var(--primary)', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          title="Editar este fluxo"
                        >
                          ✏️ Editar
                        </button>
                        <button 
                          onClick={() => deletarFluxo(fluxo.id)}
                          style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#fca5a5', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          title="Excluir este fluxo"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    
                    {/* Mensagem Inicial (Gatilho) */}
                    <div style={{ background: 'rgba(56, 189, 248, 0.08)', padding: '0.65rem 0.85rem', borderRadius: '6px', borderLeft: '3px solid var(--primary)', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--primary)', display: 'block', marginBottom: '0.2rem', fontWeight: 'bold' }}>
                        🏁 GATILHO INICIAL:
                      </span>
                      <span style={{ fontSize: '0.9rem', color: '#f1f5f9' }}>"{fluxo.mensagem_inicial}"</span>
                    </div>
                    
                    {/* Sequência de Passos */}
                    <div className="steps-list" style={{ margin: '0.5rem 0' }}>
                      {fluxo.interacoes.map((i, idx) => {
                        let esperaTxt = '';
                        if (i.tipo_espera === 'qualquer_mensagem') esperaTxt = 'Qualquer mensagem';
                        else if (i.tipo_espera === 'multiplas_mensagens') esperaTxt = `Aguardar ${i.valor_espera || 'N'} mensagens`;
                        else if (i.tipo_espera === 'texto_exato') esperaTxt = `Texto contendo "${i.valor_espera}"`;
                        else if (i.tipo_espera === 'regex') esperaTxt = `Padrão "${i.valor_espera}"`;
                        else if (i.tipo_espera === 'arquivo') esperaTxt = 'Receber Documento';

                        let respTxt = '';
                        if (i.tipo_resposta === 'enviar_coluna' || (i.tipo_resposta === 'enviar_texto' && isDynamicParam(i))) {
                          respTxt = `Dado da Planilha [${i.valor_resposta || 'cpf'}]`;
                        } else if (i.tipo_resposta === 'enviar_texto_fixo' || i.tipo_resposta === 'enviar_texto') {
                          respTxt = `Texto Padrão "${i.valor_resposta}"`;
                        } else if (i.tipo_resposta === 'baixar_e_continuar') {
                          respTxt = i.valor_resposta ? `Baixar doc e enviar "${i.valor_resposta}"` : 'Baixar doc e Continuar';
                        } else if (i.tipo_resposta === 'finalizar_baixar') {
                          respTxt = 'Baixar doc e Finalizar';
                        } else {
                          respTxt = 'Finalizar com sucesso';
                        }
                        
                        return (
                          <div key={idx} className="step-item">
                            <strong style={{ color: 'var(--primary)' }}>Passo {idx + 1}:</strong> Se <em>{esperaTxt}</em> &rarr; <strong>{respTxt}</strong>
                          </div>
                        );
                      })}
                    </div>

                    {/* Colunas Exigidas em Pills */}
                    <div style={{ marginTop: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--success)', fontWeight: 'bold' }}>
                          📊 Colunas da Planilha ({colunas.length}):
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          (Início + 1 coluna por passo)
                        </span>
                      </div>
                      <div className="column-pills-container">
                        {colunas.map((col, idx) => (
                          <div key={idx} className="column-pill" title={`Nome técnico da coluna no Excel: ${col}`}>
                            <span className="pill-index">{idx + 1}</span>
                            <span className="pill-label">{rotuloColuna(col)}</span>
                            <span className="pill-code">{col}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bloco de Upload e Prévia do Lote da Planilha */}
                    <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {upload && (
                        <div style={{ background: upload.valido ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)', padding: '0.7rem 0.9rem', borderRadius: '6px', border: upload.valido ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div>
                              <span style={{ color: upload.valido ? '#86efac' : '#fca5a5', fontWeight: 'bold' }}>
                                {upload.valido ? '✅ Planilha Pronta:' : '⚠️ Planilha Incompleta:'}
                              </span>{' '}
                              <strong style={{ color: '#fff' }}>{upload.fileName}</strong>{' '}
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({upload.rows.length} cliente(s))</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button
                                type="button"
                                onClick={() => setPreviewFlowId(previewFlowId === fluxo.id ? null : fluxo.id)}
                                className="btn"
                                style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)', color: '#cbd5e1' }}
                              >
                                {previewFlowId === fluxo.id ? '✕ Fechar Prévia' : '👁️ Ver Prévia'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setFlowUploads(prev => {
                                    const next = { ...prev };
                                    delete next[fluxo.id];
                                    return next;
                                  });
                                  if (previewFlowId === fluxo.id) setPreviewFlowId(null);
                                }}
                                className="btn"
                                style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}
                                title="Remover planilha deste fluxo"
                              >
                                Remover
                              </button>
                            </div>
                          </div>

                          {upload.colunasFaltando.length > 0 && (
                            <div style={{ marginTop: '0.4rem', color: '#f87171', fontSize: '0.78rem' }}>
                              ⚠️ Faltam colunas exigidas pelo fluxo: <strong>{upload.colunasFaltando.join(', ')}</strong>. Baixe o modelo (.xlsx) deste fluxo e use-o como base.
                            </div>
                          )}

                          {previewFlowId === fluxo.id && (
                            <div style={{ marginTop: '0.6rem', overflowX: 'auto', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', padding: '0.5rem', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '0.4rem' }}>
                                👁️ Prévia das Primeiras Linhas da Planilha:
                              </div>
                              <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--border)', color: '#38bdf8' }}>
                                    <th style={{ padding: '0.35rem 0.5rem' }}>#</th>
                                    {upload.colunasPresentes.map((c, i) => (
                                      <th key={i} style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}>{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {upload.rows.slice(0, 3).map((r, ri) => (
                                    <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                      <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)' }}>{ri + 1}</td>
                                      {upload.colunasPresentes.map((c, ci) => (
                                        <td key={ci} style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', color: '#f1f5f9' }}>
                                          {r[c] !== undefined && r[c] !== '' ? String(r[c]) : '-'}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {upload.rows.length > 3 && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'center' }}>
                                  ... e mais {upload.rows.length - 3} linha(s) de clientes prontas para processamento.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="card-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                        <button 
                          onClick={() => baixarModeloExcel(fluxo)}
                          className="btn btn-primary"
                          style={{ flex: '1 1 calc(50% - 0.25rem)', fontSize: '0.85rem', padding: '0.65rem', justifyContent: 'center' }}
                          title="Baixar planilha padrão (.xlsx) já com todas as colunas corretas deste fluxo"
                        >
                          📥 Baixar Modelo (.xlsx)
                        </button>

                        <label className="btn" style={{ flex: '1 1 calc(50% - 0.25rem)', background: upload ? 'rgba(16, 185, 129, 0.18)' : '#6366f1', border: upload ? '1px solid #10b981' : '1px solid transparent', color: '#fff', fontSize: '0.85rem', padding: '0.65rem', textAlign: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          {upload ? `📂 Trocar Planilha` : '📤 Subir Planilha (.xlsx)'}
                          <input type="file" accept=".csv, .xlsx" style={{ display: 'none' }} onChange={(e) => handleCSVUpload(fluxo, e)} />
                        </label>

                        <button 
                          onClick={() => iniciarExecucaoFluxoCSV(fluxo)}
                          disabled={!upload || upload.rows.length === 0}
                          className="btn btn-success"
                          style={{ 
                            flex: '1 1 100%', 
                            fontSize: '0.92rem', 
                            padding: '0.75rem', 
                            fontWeight: 'bold',
                            justifyContent: 'center',
                            opacity: (!upload || upload.rows.length === 0) ? 0.35 : 1,
                            cursor: (!upload || upload.rows.length === 0) ? 'not-allowed' : 'pointer',
                            boxShadow: (upload && upload.rows.length > 0) ? '0 4px 14px rgba(16, 185, 129, 0.4)' : 'none'
                          }}
                        >
                          🚀 Iniciar Fluxo em Lote {!upload && '(Suba a planilha primeiro)'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {fluxos.length === 0 && (
                <p style={{ color: 'var(--text-muted)' }}>Nenhum fluxo configurado. Crie um acima!</p>
              )}
            </div>
          </div>
        )}

        {tab === 'whatsapp' && (
          <div className="glass-card" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center', padding: '2rem' }}>
            <h2 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>Conectar Dispositivo WhatsApp</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
              Escaneie o QR Code abaixo para autenticar o robô.
            </p>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)', minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {wppStatus === 'desconectado' && (
                <>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📱</div>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>O robô está atualmente desconectado.</p>
                  <button onClick={gerarQrCode} className="btn btn-primary">
                    🔗 Gerar QR Code de Conexão
                  </button>
                </>
              )}

              {wppStatus === 'gerando' && (
                <>
                  <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(56, 189, 248, 0.3)', borderTop: '3px solid var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '1rem' }}></div>
                  <p style={{ color: 'var(--primary)' }}>Solicitando sessão com o servidor WPP...</p>
                  <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </>
              )}

              {wppStatus === 'aguardando' && qrCodeData && (
                <>
                  <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                    <img src={qrCodeData} alt="QR Code WhatsApp" style={{ display: 'block', width: '200px', height: '200px' }} />
                  </div>
                  <p style={{ color: 'var(--text-muted)' }}>Abra o WhatsApp no seu celular e escaneie o código.</p>
                </>
              )}

              {wppStatus === 'conectado' && (
                <>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                  <h3 style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>Autenticado com Sucesso!</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>O robô está pronto para enviar e receber mensagens.</p>
                  <button onClick={desconectarWpp} className="btn btn-danger">
                    Desconectar Sessão
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'execucoes' && (
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h2>Fila de Execuções e Logs do Sistema (Tempo Real)</h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  Histórico detalhado de webhooks recebidos, avaliação de regras, mensagens enviadas e controle de lote.
                </p>
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button 
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/fila/exportar_resumo');
                      const data = await res.json();
                      if (data.length === 0) {
                        alert("Nenhuma execução em lote registrada ainda para exportar.");
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
                    } catch (e) {
                      alert("Erro ao exportar resumo do lote.");
                    }
                  }}
                  className="btn btn-primary"
                  style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                >
                  📊 Baixar Resumo (.xlsx)
                </button>

                <button 
                  onClick={async () => {
                    if (window.confirm("Deseja realmente PARAR o lote em andamento e cancelar todos os itens pendentes?")) {
                      try {
                        const res = await fetch('/api/fila/cancelar', { method: 'POST' });
                        const data = await res.json();
                        alert(`Processo interrompido! ${data.itens_cancelados} item(ns) pendente(s) cancelado(s).`);
                      } catch (e) {
                        alert("Erro ao cancelar o lote.");
                      }
                    }
                  }}
                  className="btn btn-danger"
                  style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                >
                  🛑 Parar Processo em Lote
                </button>

                <button 
                  onClick={async () => {
                    if (window.confirm("Deseja limpar todo o histórico de logs da tela?")) {
                      try {
                        await fetch('/api/logs/limpar', { method: 'POST' });
                        setLogs([]);
                      } catch (e) {
                        alert("Erro ao limpar logs.");
                      }
                    }
                  }}
                  className="btn"
                  style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                >
                  🧹 Limpar Logs
                </button>
              </div>
            </div>
            
            <div style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', fontFamily: 'monospace', maxHeight: '500px', overflowY: 'auto' }}>
              {logs.length > 0 ? (
                logs.map(log => (
                  <div key={log.id} style={{ marginBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.8rem', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>[{log.timestamp}]</span>
                      <span style={{ color: log.nivel === 'INFO' ? 'var(--primary)' : log.nivel === 'WARN' ? '#fde047' : 'var(--danger)', fontWeight: 'bold' }}>[{log.nivel}]</span>
                      <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{log.mensagem}</span>
                    </div>
                    {Object.keys(log.detalhes || {}).length > 0 && (
                      <pre style={{ margin: '0.3rem 0 0 1rem', fontSize: '0.8rem', color: '#94a3b8', background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(log.detalhes, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
                  Nenhum log registrado ainda.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Wizard (Modal Assistente) - aditivo, não altera o editor atual */}
      {wizardAberto && (
        <div className="modal-overlay" onClick={fecharWizard}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ color: 'var(--primary)', margin: 0 }}>🧙 Assistente de Interações</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Passo {wizardPasso + 1} de {WIZARD_PASSOS.length} · {WIZARD_PASSOS[wizardPasso]}
                </span>
              </div>
              <button type="button" className="modal-close" onClick={fecharWizard} title="Fechar">✕</button>
            </div>

            <div className="modal-body">
              {wizardPasso === 0 && (
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    Defina a identificação do fluxo e a mensagem inicial que o robô enviará para abrir a conversa.
                  </p>
                  <div className="form-group">
                    <label className="form-label">Nome do Fluxo</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: Consulta CNPJ Prefeitura"
                      value={wizardDados.nome}
                      onChange={(e) => atualizarWizardDados('nome', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Telefone do Robô Receptor</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: 5511999999999"
                      value={wizardDados.receptor}
                      onChange={(e) => atualizarWizardDados('receptor', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'var(--primary)' }}>Mensagem Inicial (Gatilho)</label>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                      Primeira mensagem que o robô deve enviar para iniciar a conversa.
                    </p>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: Oi, gostaria de consultar o CNPJ"
                      value={wizardDados.mensagemInicial}
                      onChange={(e) => atualizarWizardDados('mensagemInicial', e.target.value)}
                    />
                  </div>
                </div>
              )}
              {wizardPasso === 1 && (
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    Monte as interações passo a passo. Para cada uma, defina o que o robô deve <strong>esperar</strong> e qual será a <strong>ação</strong> dele.
                  </p>

                  {wizardDados.interacoes.map((interacao, index) => (
                    <div key={index} className="rule-item" style={{ marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>Interação {index + 1}</span>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)', color: '#fff', opacity: index === 0 ? 0.4 : 1 }}
                            disabled={index === 0}
                            onClick={() => moverWizardInteracao(index, -1)}
                            title="Mover para cima"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)', color: '#fff', opacity: index === wizardDados.interacoes.length - 1 ? 0.4 : 1 }}
                            disabled={index === wizardDados.interacoes.length - 1}
                            onClick={() => moverWizardInteracao(index, 1)}
                            title="Mover para baixo"
                          >
                            ↓
                          </button>
                          {wizardDados.interacoes.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                              onClick={() => removerWizardInteracao(index)}
                            >
                              Remover
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '220px' }}>
                          <label className="form-label" style={{ color: '#cbd5e1' }}>1. O que o robô deve esperar?</label>
                          <select
                            className="form-input"
                            value={interacao.tipo_espera}
                            onChange={(e) => atualizarWizardInteracao(index, 'tipo_espera', e.target.value)}
                            style={{ marginBottom: (interacao.tipo_espera === 'texto_exato' || interacao.tipo_espera === 'regex' || interacao.tipo_espera === 'multiplas_mensagens') ? '0.4rem' : '0', color: 'var(--text-main)' }}
                          >
                            {WIZARD_OPCOES_ESPERA.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                          {(interacao.tipo_espera === 'texto_exato' || interacao.tipo_espera === 'regex' || interacao.tipo_espera === 'multiplas_mensagens') && (
                            <input
                              type={interacao.tipo_espera === 'multiplas_mensagens' ? 'number' : 'text'}
                              min={interacao.tipo_espera === 'multiplas_mensagens' ? '2' : undefined}
                              className="form-input"
                              placeholder={
                                interacao.tipo_espera === 'texto_exato' ? 'Ex: Digite seu CPF' :
                                interacao.tipo_espera === 'regex' ? 'Ex: ^[0-9]{11}$' : 'Qtd de mensagens a esperar (ex: 3)'
                              }
                              value={interacao.valor_espera}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_espera', e.target.value)}
                            />
                          )}
                        </div>

                        <div style={{ flex: 1, minWidth: '220px' }}>
                          <label className="form-label" style={{ color: '#cbd5e1' }}>2. Qual será a ação do robô?</label>
                          <select
                            className="form-input"
                            value={
                              interacao.tipo_resposta === 'enviar_texto'
                                ? (isDynamicParam(interacao) ? 'enviar_coluna' : 'enviar_texto_fixo')
                                : interacao.tipo_resposta
                            }
                            onChange={(e) => atualizarWizardInteracao(index, 'tipo_resposta', e.target.value)}
                            style={{ marginBottom: '0.4rem', color: 'var(--text-main)' }}
                          >
                            {WIZARD_OPCOES_RESPOSTA.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                          
                          {/* Input para Texto Fixo */}
                          {(interacao.tipo_resposta === 'enviar_texto_fixo' || (interacao.tipo_resposta === 'enviar_texto' && !isDynamicParam(interacao))) && (
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Texto fixo que o robô vai enviar (Ex: 1, Financeiro, Sim, Sair)"
                              value={interacao.valor_resposta}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_resposta', e.target.value)}
                            />
                          )}

                          {/* Input para Coluna da Planilha */}
                          {(interacao.tipo_resposta === 'enviar_coluna' || (interacao.tipo_resposta === 'enviar_texto' && isDynamicParam(interacao))) && (
                            <input
                              type="text"
                              className="form-input"
                              style={{ border: '1px solid #10b981', background: 'rgba(16, 185, 129, 0.08)' }}
                              placeholder="Nome da coluna da planilha (Ex: cpf, cnpj, telefone)"
                              value={interacao.valor_resposta}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_resposta', e.target.value)}
                            />
                          )}

                          {/* Input para Baixar e Continuar */}
                          {interacao.tipo_resposta === 'baixar_e_continuar' && (
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Texto opcional a enviar após baixar (Ex: Sair)"
                              value={interacao.valor_resposta}
                              onChange={(e) => atualizarWizardInteracao(index, 'valor_resposta', e.target.value)}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={adicionarWizardInteracao} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                    + Adicionar Interação
                  </button>
                </div>
              )}
              {wizardPasso === 2 && (
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    Revise o fluxo montado. Ao confirmar, os dados abaixo serão levados para o editor — depois é só clicar em <strong>Salvar Fluxo</strong>.
                  </p>

                  <div style={{ background: 'rgba(56, 189, 248, 0.1)', padding: '0.8rem', borderRadius: '6px', borderLeft: '3px solid var(--primary)', marginBottom: '1rem' }}>
                    <div style={{ marginBottom: '0.4rem' }}><strong>Nome:</strong> {wizardDados.nome || <em style={{ color: 'var(--text-muted)' }}>(vazio)</em>}</div>
                    <div style={{ marginBottom: '0.4rem' }}><strong>Receptor:</strong> {wizardDados.receptor || <em style={{ color: 'var(--text-muted)' }}>Não informado</em>}</div>
                    <div><strong>Mensagem Inicial:</strong> "{wizardDados.mensagemInicial}"</div>
                  </div>

                  <div className="steps-list" style={{ margin: 0 }}>
                    {wizardDados.interacoes.map((i, idx) => (
                      <div key={idx} className="step-item">
                        <strong>Passo {idx + 1}:</strong> Se <em>{descreverEsperaWizard(i)}</em> &rarr; <strong>{descreverRespostaWizard(i)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }} onClick={fecharWizard}>
                Cancelar
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={wizardPasso === 0}
                  style={{ opacity: wizardPasso === 0 ? 0.4 : 1 }}
                  onClick={() => setWizardPasso((p) => Math.max(0, p - 1))}
                >
                  ← Voltar
                </button>
                {wizardPasso < WIZARD_PASSOS.length - 1 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={avancarWizard}
                  >
                    Avançar →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={aplicarWizard}
                  >
                    ✅ Concluir e Aplicar
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

import React, { useState } from 'react';

function App() {
  const [tab, setTab] = useState('fluxos');
  const [fluxos, setFluxos] = useState([
    {
      id: 'fluxo_1',
      nome: 'Consulta Certidão GOV',
      receptor: '5511999999999',
      interacoes: [
        { ordem: 1, espera: '1 mensagem qualquer', resposta: '{{cliente.cpf}}' },
        { ordem: 2, espera: 'Texto contendo "Digite a data"', resposta: '{{cliente.data_nascimento}}' },
        { ordem: 3, espera: 'Receber PDF / "Atendimento concluído"', resposta: '[FINALIZAR_FLUXO]' }
      ],
      parametros_exigidos: ['CPF_Cliente', 'Data_Nascimento']
    }
  ]);

  const [novoFluxoNome, setNovoFluxoNome] = useState('');
  const [novoReceptor, setNovoReceptor] = useState('');

  const criarFluxo = (e) => {
    e.preventDefault();
    if (!novoFluxoNome) return;
    const novo = {
      id: `fluxo_${Date.now()}`,
      nome: novoFluxoNome,
      receptor: novoReceptor || 'Não informado',
      interacoes: [],
      parametros_exigidos: []
    };
    setFluxos([...fluxos, novo]);
    setNovoFluxoNome('');
    setNovoReceptor('');
  };

  const baixarModeloExcel = (fluxo) => {
    const colunas = ['nome_cliente', 'telefone_receptor', ...fluxo.parametros_exigidos];
    const csvContent = "data:text/csv;charset=utf-8," + colunas.join(",") + "\nEmpresa LTDA,5511999999999," + fluxo.parametros_exigidos.map(() => 'EXEMPLO').join(",");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `modelo_planilha_${fluxo.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '100vh', padding: '2rem' }}>
      <header style={{ borderBottom: '1px solid #334155', paddingBottom: '1rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, color: '#38bdf8' }}>Orquestrador WhatsApp (wpp_server)</h1>
          <p style={{ margin: '0.5rem 0 0', color: '#94a3b8' }}>Painel de Gestão de Automações & Carga de Parâmetros</p>
        </div>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <button 
            onClick={() => setTab('fluxos')}
            style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: 'none', background: tab === 'fluxos' ? '#0284c7' : '#1e293b', color: '#fff', cursor: 'pointer' }}
          >
            Fluxos de Automação
          </button>
          <button 
            onClick={() => setTab('execucoes')}
            style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: 'none', background: tab === 'execucoes' ? '#0284c7' : '#1e293b', color: '#fff', cursor: 'pointer' }}
          >
            Execuções & Logs
          </button>
        </nav>
      </header>

      <main>
        {tab === 'fluxos' && (
          <div>
            <section style={{ background: '#1e293b', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
              <h2 style={{ marginTop: 0, color: '#f1f5f9' }}>Novo Fluxo de Automação Linear</h2>
              <form onSubmit={criarFluxo} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <input 
                  type="text" 
                  placeholder="Nome do Fluxo (ex: Consulta GOV)" 
                  value={novoFluxoNome}
                  onChange={(e) => setNovoFluxoNome(e.target.value)}
                  style={{ flex: 1, minWidth: '250px', padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }}
                />
                <input 
                  type="text" 
                  placeholder="Telefone Receptor Padrão" 
                  value={novoReceptor}
                  onChange={(e) => setNovoReceptor(e.target.value)}
                  style={{ flex: 1, minWidth: '200px', padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }}
                />
                <button type="submit" style={{ background: '#10b981', color: '#fff', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                  + Criar Fluxo
                </button>
              </form>
            </section>

            <h2>Fluxos Configurados</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
              {fluxos.map(fluxo => (
                <div key={fluxo.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', color: '#38bdf8' }}>{fluxo.nome}</h3>
                  <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#94a3b8' }}>Receptor: {fluxo.receptor}</p>
                  
                  <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '6px', marginBottom: '1rem' }}>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#cbd5e1' }}>Interações do Fluxo ({fluxo.interacoes.length}):</h4>
                    {fluxo.interacoes.map(i => (
                      <div key={i.ordem} style={{ fontSize: '0.8rem', color: '#94a3b8', borderBottom: '1px dashed #334155', padding: '0.3rem 0' }}>
                        <strong>Passo {i.ordem}:</strong> Esperar ({i.espera}) &rarr; Resposta ({i.resposta})
                      </div>
                    ))}
                  </div>

                  <div style={{ background: '#1e293b', border: '1px solid #475569', padding: '0.8rem', borderRadius: '6px', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.8rem', display: 'block', color: '#a7f3d0', marginBottom: '0.4rem' }}>
                      <strong>Formato da Planilha Esperada:</strong>
                    </span>
                    <code style={{ fontSize: '0.75rem', background: '#0f172a', padding: '0.2rem 0.4rem', borderRadius: '4px', color: '#38bdf8' }}>
                      nome_cliente, telefone_receptor, {fluxo.parametros_exigidos.join(', ')}
                    </code>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      onClick={() => baixarModeloExcel(fluxo)}
                      style={{ flex: 1, background: '#0284c7', color: '#fff', border: 'none', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      📥 Baixar Modelo (.csv)
                    </button>
                    <label style={{ flex: 1, background: '#8b5cf6', color: '#fff', textAlign: 'center', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>
                      📤 Subir Planilha
                      <input type="file" accept=".csv, .xlsx" style={{ display: 'none' }} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'execucoes' && (
          <div style={{ background: '#1e293b', padding: '1.5rem', borderRadius: '8px' }}>
            <h2>Fila de Execuções e Logs em Tempo Real</h2>
            <p style={{ color: '#94a3b8' }}>Nenhuma tarefa em andamento no momento.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

import { useEffect, useState } from 'react';

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A próxima leitura só é agendada quando a atual termina: nunca há duas em andamento, então
    // uma resposta lenta não chega depois de uma mais nova e não faz o status voltar na tela.
    const run = async () => {
      try {
        const data = await fetcher();
        if (active) setState({ data });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (active) setState((previous) => ({ ...previous, error: message }));
      }
      if (active) timer = setTimeout(run, intervalMs);
    };
    void run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // fetcher fica fora das dependências de propósito: muda a cada render, e quem diz quando
    // reiniciar a busca é a chave (token, id) ou um reload() explícito.
  }, [key, round, intervalMs]);

  return { ...state, reload: () => setRound((current) => current + 1) };
}

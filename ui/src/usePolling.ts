import { useEffect, useState } from 'react';

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    const update = () =>
      fetcher().then(
        (data) => active && setState({ data }),
        (error: Error) => active && setState((previous) => ({ ...previous, error: error.message })),
      );
    void update();
    const timer = setInterval(update, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // fetcher fica fora das dependências de propósito: muda a cada render, e quem diz quando
    // reiniciar a busca é a chave (token, id) ou um reload() explícito.
  }, [key, round, intervalMs]);

  return { ...state, reload: () => setRound((current) => current + 1) };
}

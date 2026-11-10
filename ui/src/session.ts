export type Session = { token: string; user: string; role: 'passageiro' | 'motorista' };

const STORAGE_KEY = 'corridas.token';

// Decodificar o token aqui serve só para mostrar quem está logado e escolher a tela.
// Quem confere a assinatura e decide o que cada um pode fazer é a API.
export function parseToken(token: string): Session | null {
  try {
    const content = token.trim().split('.')[1] ?? '';
    const claims = JSON.parse(atob(content.replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.role !== 'passageiro' && claims.role !== 'motorista') return null;
    return { token: token.trim(), user: String(claims.sub), role: claims.role };
  } catch {
    return null;
  }
}

export function savedSession(): Session | null {
  const token = sessionStorage.getItem(STORAGE_KEY);
  return token ? parseToken(token) : null;
}

export const saveSession = (session: Session) => sessionStorage.setItem(STORAGE_KEY, session.token);

export const clearSession = () => sessionStorage.removeItem(STORAGE_KEY);

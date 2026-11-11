// Tokens de teste do repositório, assinados por uma chave que já foi descartada. Os botões só
// preenchem o token: a API valida a assinatura de cada um como faria com um token colado.
import driver1 from '../../auth-dev/tokens/motorista-1.jwt?raw';
import driver2 from '../../auth-dev/tokens/motorista-2.jwt?raw';
import passenger1 from '../../auth-dev/tokens/passageiro-1.jwt?raw';
import passenger2 from '../../auth-dev/tokens/passageiro-2.jwt?raw';

export const TEST_ACCOUNTS = [
  { label: 'Passageiro 1', token: passenger1.trim() },
  { label: 'Passageiro 2', token: passenger2.trim() },
  { label: 'Motorista 1', token: driver1.trim() },
  { label: 'Motorista 2', token: driver2.trim() },
];

import { describe, expect, it } from 'vitest';
import { canRead, isTransitionAllowed, rejectionReason, requiresAssignedDriver } from './rules.js';

const passenger1 = { id: 'passageiro-1', role: 'passageiro' } as const;
const passenger2 = { id: 'passageiro-2', role: 'passageiro' } as const;
const driver1 = { id: 'motorista-1', role: 'motorista' } as const;
const driver2 = { id: 'motorista-2', role: 'motorista' } as const;

describe('transições de status', () => {
  it('segue a ordem solicitada, aceita, em_andamento, finalizada', () => {
    expect(isTransitionAllowed('requested', 'accepted')).toBe(true);
    expect(isTransitionAllowed('accepted', 'in_progress')).toBe(true);
    expect(isTransitionAllowed('in_progress', 'finished')).toBe(true);
  });

  it('recusa pular etapas ou voltar', () => {
    expect(isTransitionAllowed('requested', 'finished')).toBe(false);
    expect(isTransitionAllowed('requested', 'in_progress')).toBe(false);
    expect(isTransitionAllowed('finished', 'accepted')).toBe(false);
    expect(isTransitionAllowed('accepted', 'accepted')).toBe(false);
  });

  it('só iniciar e finalizar exigem o motorista da corrida', () => {
    expect(requiresAssignedDriver('accepted')).toBe(false);
    expect(requiresAssignedDriver('in_progress')).toBe(true);
    expect(requiresAssignedDriver('finished')).toBe(true);
  });
});

describe('quem pode ler uma corrida', () => {
  const requested = {
    passengerId: 'passageiro-1',
    driverId: null,
    status: 'requested' as const,
  };
  const acceptedByDriver1 = {
    ...requested,
    driverId: 'motorista-1',
    status: 'accepted' as const,
  };

  it('o passageiro lê só as próprias', () => {
    expect(canRead(requested, passenger1)).toBe(true);
    expect(canRead(requested, passenger2)).toBe(false);
  });

  it('qualquer motorista lê uma corrida disponível, para decidir se aceita', () => {
    expect(canRead(requested, driver2)).toBe(true);
  });

  it('depois de aceita, só o motorista da corrida lê', () => {
    expect(canRead(acceptedByDriver1, driver1)).toBe(true);
    expect(canRead(acceptedByDriver1, driver2)).toBe(false);
  });
});

describe('por que uma mudança de status foi recusada', () => {
  const ride = (status: 'requested' | 'accepted' | 'in_progress', driverId: string | null) => ({
    passengerId: 'passageiro-1',
    driverId,
    status,
  });

  it('finalizar uma corrida que ninguém aceitou é transição inválida, não corrida de outro', () => {
    expect(rejectionReason(ride('requested', null), 'motorista-1', 'finished')).toBe(
      'invalid_transition',
    );
  });

  it('iniciar a corrida aceita por outro motorista é proibido', () => {
    expect(rejectionReason(ride('accepted', 'motorista-2'), 'motorista-1', 'in_progress')).toBe(
      'other_driver',
    );
  });

  it('o próprio motorista pulando uma etapa é transição inválida', () => {
    expect(rejectionReason(ride('accepted', 'motorista-1'), 'motorista-1', 'finished')).toBe(
      'invalid_transition',
    );
  });

  it('aceitar uma corrida que outro já aceitou é transição inválida', () => {
    expect(rejectionReason(ride('accepted', 'motorista-2'), 'motorista-1', 'accepted')).toBe(
      'invalid_transition',
    );
  });
});

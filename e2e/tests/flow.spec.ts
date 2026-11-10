import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const token = (name: string) =>
  readFileSync(new URL(`../../auth-dev/tokens/${name}.jwt`, import.meta.url), 'utf8').trim();

const unique = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

async function login(page: Page, person: string) {
  await page.goto('/');
  await page.getByTestId('token-input').fill(token(person));
  await page.getByTestId('login-button').click();
  await expect(page.getByTestId('user')).toContainText(person);
}

async function createRideThroughApi(request: APIRequestContext, origin: string) {
  const response = await request.post('/api/corridas', {
    headers: {
      authorization: `Bearer ${token('passageiro-7')}`,
      'idempotency-key': randomUUID(),
    },
    data: { origin, destination: 'Centro' },
  });
  expect(response.status()).toBe(201);
}

test('passageiro pede a corrida e acompanha o motorista aceitar, iniciar e finalizar', async ({
  browser,
}) => {
  const origin = unique('Teste e2e');

  const passengerContext = await browser.newContext();
  const passenger = await passengerContext.newPage();
  await login(passenger, 'passageiro-7');
  await passenger.getByTestId('origin').fill(origin);
  await passenger.getByTestId('destination').fill('Maracanã');
  await passenger.getByTestId('request-ride').click();
  const trackedStatus = passenger.getByTestId('tracking').getByTestId('status');
  await expect(trackedStatus).toHaveText('Solicitada');

  const driverContext = await browser.newContext();
  const driver = await driverContext.newPage();
  await login(driver, 'motorista-1');
  await driver
    .getByTestId('available-ride')
    .filter({ hasText: origin })
    .getByRole('button', { name: 'Aceitar' })
    .click();
  await expect(trackedStatus).toHaveText('Aceita');

  const ownRide = driver.getByTestId('driver-ride').filter({ hasText: origin });
  await ownRide.getByRole('button', { name: 'Iniciar' }).click();
  await expect(trackedStatus).toHaveText('Em andamento');
  await ownRide.getByRole('button', { name: 'Finalizar' }).click();
  await expect(trackedStatus).toHaveText('Finalizada');

  await passengerContext.close();
  await driverContext.close();
});

test('duplo clique em Aceitar aceita uma corrida só', async ({ page, request }) => {
  const first = unique('Duplo A');
  const second = unique('Duplo B');
  await createRideThroughApi(request, first);
  await createRideThroughApi(request, second);

  await login(page, 'motorista-2');
  await page
    .getByTestId('available-ride')
    .filter({ hasText: first })
    .getByRole('button', { name: 'Aceitar' })
    .dblclick();

  await expect(page.getByTestId('driver-ride').filter({ hasText: first })).toBeVisible();
  await expect(page.getByTestId('available-ride').filter({ hasText: second })).toBeVisible();
  await expect(page.getByTestId('driver-error')).toHaveCount(0);
});

test('token assinado por outra chave é recusado no login', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('token-input').fill(token('other-key'));
  await page.getByTestId('login-button').click();
  await expect(page.getByTestId('login-error')).toHaveText('Token inválido ou expirado.');
});

test('passageiro não vê a tela do motorista', async ({ page }) => {
  await login(page, 'passageiro-7');
  await expect(page.getByTestId('origin')).toBeVisible();
  await expect(page.getByText('Corridas disponíveis')).toHaveCount(0);
});

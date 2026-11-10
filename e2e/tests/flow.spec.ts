import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const token = (name: string) =>
  readFileSync(new URL(`../../auth-dev/tokens/${name}.jwt`, import.meta.url), 'utf8').trim();

async function login(page: Page, person: string) {
  await page.goto('/');
  await page.getByTestId('token-input').fill(token(person));
  await page.getByTestId('login-button').click();
  await expect(page.getByTestId('user')).toContainText(person);
}

test('passageiro pede a corrida e acompanha o motorista aceitar, iniciar e finalizar', async ({
  browser,
}) => {
  const origin = `Teste e2e ${randomUUID().slice(0, 8)}`;

  const passenger = await (await browser.newContext()).newPage();
  await login(passenger, 'passageiro-7');
  await passenger.getByTestId('origin').fill(origin);
  await passenger.getByTestId('destination').fill('Maracanã');
  await passenger.getByTestId('request-ride').click();
  const trackedStatus = passenger.getByTestId('tracking').getByTestId('status');
  await expect(trackedStatus).toHaveText('Solicitada');

  const driver = await (await browser.newContext()).newPage();
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

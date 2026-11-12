// Baseline Smoke Test
const BASE_URL = process.env.GATEWAY_URL || 'http://localhost:4000';

async function main() {
  console.log(`[smoke] Checking Gateway health at ${BASE_URL}/api/health ...`);
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status} ${healthRes.statusText}`);
  }
  const healthData = await healthRes.json();
  console.log('[smoke] Health check OK:', healthData);

  console.log('[smoke] Logging in as manager1 ...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'manager1',
      password: process.env.MANAGER_PASSWORD || 'Warehouse#2026'
    })
  });

  if (!loginRes.ok) {
    const errText = await loginRes.text();
    throw new Error(`Login failed (${loginRes.status}): ${errText}`);
  }

  const loginData = (await loginRes.json()) as { token: string; user: any };
  const token = loginData.token;
  console.log(`[smoke] Logged in successfully as ${loginData.user.username} (${loginData.user.role})`);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  console.log('[smoke] Calling /api/dashboard ...');
  const dashRes = await fetch(`${BASE_URL}/api/dashboard`, { headers: authHeaders });
  if (!dashRes.ok) {
    throw new Error(`/api/dashboard failed: ${dashRes.status} ${await dashRes.text()}`);
  }
  console.log('[smoke] /api/dashboard OK');

  console.log('[smoke] Calling /api/orders ...');
  const ordersRes = await fetch(`${BASE_URL}/api/orders`, { headers: authHeaders });
  if (!ordersRes.ok) {
    throw new Error(`/api/orders failed: ${ordersRes.status} ${await ordersRes.text()}`);
  }
  console.log('[smoke] /api/orders OK');

  console.log('[smoke] Calling /api/inventory/summary ...');
  const invRes = await fetch(`${BASE_URL}/api/inventory/summary`, { headers: authHeaders });
  if (!invRes.ok) {
    throw new Error(`/api/inventory/summary failed: ${invRes.status} ${await invRes.text()}`);
  }
  console.log('[smoke] /api/inventory/summary OK');

  console.log('[smoke] All baseline smoke checks PASSED.');
  process.exitCode = 0;
}

main().catch(err => {
  console.error('[smoke] Smoke test FAILED:', err);
  process.exit(1);
});

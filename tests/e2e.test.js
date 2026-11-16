process.env.NODE_ENV = 'test';
process.env.PAYMENT_WEBHOOK_SECRET = 'test_secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const app = require('../src/app');
const realtime = require('../src/services/realtime');
const store = require('../src/models/store');
const { todayStr, addDays, dayKey } = require('../src/utils/dates');

const PASSWORD = 'Password123!';
let server;
let base;

const api = async (method, path, { token, body, headers = {} } = {}) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const login = async (email, role) => {
  const r = await api('POST', '/auth/login', { body: { email, password: PASSWORD, role } });
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`);
  return r.body.data.token;
};

const bookableDay = () => {
  for (let i = 1; i < 8; i += 1) {
    const d = addDays(todayStr(), i);
    if (dayKey(d) !== 'sun' && dayKey(d) !== 'sat') return d;
  }
  throw new Error('sin día hábil');
};

test.before(async () => {
  server = http.createServer(app);
  realtime.attach(server);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('salud, 404 y autenticación', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await api('GET', '/no-existe')).status, 404);
  assert.equal((await api('GET', '/orders')).status, 401);
});

test('registro valida consentimiento, rol y contraseña; OTP de 6 dígitos', async () => {
  const base1 = { name: 'Ana', email: 'ana@test.com', password: 'Password123!' };
  assert.equal((await api('POST', '/auth/register', { body: base1 })).status, 400); // sin acceptTerms
  assert.equal((await api('POST', '/auth/register', { body: { ...base1, acceptTerms: true, role: 'ADMIN' } })).status, 400);
  assert.equal((await api('POST', '/auth/register', { body: { ...base1, acceptTerms: true, password: '123' } })).status, 400);
  const ok = await api('POST', '/auth/register', { body: { ...base1, acceptTerms: true, phone: '+573005550000' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.user.passwordHash, undefined);
  assert.equal((await api('POST', '/auth/register', { body: { ...base1, acceptTerms: true } })).status, 409);

  assert.equal((await api('POST', '/auth/login', { body: { email: 'ana@test.com', password: 'mala-clave' } })).status, 401);

  const otp = await api('POST', '/auth/otp', { body: { phone: '+573005550000' } });
  assert.match(otp.body.otpCode, /^\d{6}$/);
  assert.equal((await api('POST', '/auth/verify', { body: { phone: '+573005550000', code: '000000' } })).status, 400);
  const verified = await api('POST', '/auth/verify', { body: { phone: '+573005550000', code: otp.body.otpCode } });
  assert.equal(verified.status, 200);
  assert.ok(verified.body.data.token && verified.body.data.refreshToken);

  const refreshed = await api('POST', '/auth/refresh', { body: { refreshToken: verified.body.data.refreshToken } });
  assert.equal(refreshed.status, 200);
  assert.equal((await api('POST', '/auth/refresh', { body: { refreshToken: verified.body.data.refreshToken } })).status, 401);
});

test('recuperar contraseña con OTP', async () => {
  const forgot = await api('POST', '/auth/password/forgot', { body: { email: 'ana@test.com' } });
  assert.equal(forgot.status, 200);
  const reset = await api('POST', '/auth/password/reset', { body: { email: 'ana@test.com', code: forgot.body.otpCode, newPassword: 'NuevaClave123' } });
  assert.equal(reset.status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { email: 'ana@test.com', password: 'NuevaClave123' } })).status, 200);
});

test('directorio: geolocalización, filtros y paginación', async () => {
  const near = await api('GET', '/technicians?lat=4.6097&lng=-74.0817&verified=true');
  assert.equal(near.status, 200);
  const distances = near.body.data.map((t) => t.distanceKm);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  assert.ok(near.body.data.every((t) => t.isVerified));
  assert.equal(near.body.data[0].wallet, undefined);

  const phones = await api('GET', '/technicians?cat=celular&home=true&minRating=4.5');
  assert.ok(phones.body.data.length >= 1 && phones.body.data.every((t) => t.rating >= 4.5 && t.homeService));
  assert.ok((await api('GET', '/technicians?q=pantalla')).body.data.length >= 1);
  const page = await api('GET', '/technicians?limit=2&page=2');
  assert.equal(page.body.meta.limit, 2);
  assert.equal((await api('GET', '/technicians?minRating=abc')).status, 400);

  const profile = await api('GET', '/technicians/1');
  assert.equal(profile.status, 200);
  assert.ok(profile.body.data.services.length && profile.body.data.ratingDistribution && profile.body.data.schedule);
  assert.equal((await api('GET', '/technicians/9999')).status, 404);
});

test('agenda → cita → pago retenido → reparación → entrega → reseña', async () => {
  const client = await login('cliente@srrobot.com');
  const tech = await login('tecnico@srrobot.com');
  const date = bookableDay();

  const avail = await api('GET', `/technicians/1/availability?date=${date}`);
  assert.equal(avail.status, 200);
  assert.ok(avail.body.availableSlots.includes('10:00'));

  const profile = (await api('GET', '/technicians/1')).body.data;
  const service = profile.services[0];
  const booking = { technicianId: 1, serviceId: service.id, date, time: '10:00', mode: 'HOME', address: 'Calle 1 # 2-3', paymentMethod: 'NEQUI' };

  assert.equal((await api('POST', '/appointments', { token: client, body: { ...booking, paymentMethod: 'PIX' } })).status, 400);
  const created = await api('POST', '/appointments', { token: client, body: booking });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { order, appointment, summary } = created.body.data;
  assert.equal(summary.total, service.priceFrom + profile.homeExtraFee);
  assert.equal(order.escrowStatus, 'HELD');
  assert.equal(order.state, 'SOLICITADO');
  assert.equal(store.technicians[0].wallet.held, summary.total);

  // la franja ya no está libre y no admite doble reserva
  assert.equal((await api('POST', '/appointments', { token: client, body: booking })).status, 409);
  const after = await api('GET', `/technicians/1/availability?date=${date}`);
  assert.ok(!after.body.availableSlots.includes('10:00'));

  // aislamiento de datos y permisos
  const other = (await api('POST', '/auth/register', { body: { name: 'Otro', email: 'otro@test.com', password: PASSWORD, acceptTerms: true } })).body.data.token;
  assert.equal((await api('GET', '/orders', { token: other })).body.count, 0);
  assert.equal((await api('GET', `/orders/${order.id}`, { token: other })).status, 403);
  assert.equal((await api('POST', `/orders/${order.id}/transitions`, { token: client, body: { newState: 'DIAGNOSTICO' } })).status, 403);

  const t = (state, extra = {}) => api('POST', `/orders/${order.id}/transitions`, { token: tech, body: { newState: state, ...extra } });
  assert.equal((await t('LISTO')).status, 400); // salto de estado inválido
  assert.equal((await t('DIAGNOSTICO')).status, 200);
  assert.equal((await api('GET', `/appointments/${appointment.id}`, { token: tech })).body.data.status, 'IN_PROGRESS');

  // costo adicional: sin aprobación no se avanza
  const adj = await api('POST', `/orders/${order.id}/adjustments`, { token: tech, body: { amount: 30000, reason: 'Cambio de flex' } });
  assert.equal(adj.status, 201);
  assert.equal((await t('EN_REPARACION')).status, 409);
  const approved = await api('POST', `/orders/${order.id}/adjustments/${adj.body.data.id}/approve`, { token: client });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.order.amount, summary.total + 30000);
  assert.equal(store.technicians[0].wallet.held, summary.total + 30000);

  assert.equal((await t('EN_REPARACION', { subState: 'PRUEBAS_CALIDAD' })).body.data.subState, 'PRUEBAS_CALIDAD');
  assert.equal((await t('LISTO')).status, 200);

  assert.equal((await api('POST', `/orders/${order.id}/reviews`, { token: client, body: { rating: 5 } })).status, 400); // aún no entregada
  const delivered = await api('POST', `/orders/${order.id}/confirm-receipt`, { token: client });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.data.state, 'ENTREGADO');
  assert.equal(delivered.body.data.escrowStatus, 'RELEASED');
  assert.ok(delivered.body.data.warranty.active);
  assert.equal(store.technicians[0].wallet.held, 0);
  assert.equal(store.technicians[0].wallet.available, summary.total + 30000);

  const review = await api('POST', `/orders/${order.id}/reviews`, { token: client, body: { rating: 4, comment: 'Todo bien', tags: ['Rápido'] } });
  assert.equal(review.status, 201);
  assert.equal((await api('POST', `/orders/${order.id}/reviews`, { token: client, body: { rating: 4 } })).status, 409);
  assert.equal((await api('POST', `/orders/${order.id}/reviews`, { token: other, body: { rating: 1 } })).status, 403);
  const reviews = (await api('GET', '/technicians/1/reviews')).body;
  assert.equal(reviews.ratingDistribution[4] >= 1, true);

  const reply = await api('POST', `/reviews/${review.body.data.id}/reply`, { token: tech, body: { replyText: 'Gracias' } });
  assert.equal(reply.status, 200);
  assert.equal((await api('POST', `/reviews/${review.body.data.id}/reply`, { token: tech, body: { replyText: 'Otra' } })).status, 409);

  // billetera y retiro
  const wallet = (await api('GET', '/technicians/me/wallet', { token: tech })).body.data;
  assert.equal(wallet.available, summary.total + 30000);
  assert.equal((await api('POST', '/technicians/me/withdrawals', { token: tech, body: { amount: wallet.available + 1, destination: { type: 'NEQUI', account: '3109876543' } } })).status, 400);
  assert.equal((await api('POST', '/technicians/me/withdrawals', { token: tech, body: { amount: 10000, destination: { type: 'NEQUI', account: '3109876543' } } })).status, 201);
  const analytics = (await api('GET', '/technicians/me/analytics', { token: tech })).body.data;
  assert.equal(analytics.completedOrders >= 1, true);
  assert.equal(analytics.totalRevenue >= summary.total, true);
});

test('cancelar cita aplica política de reembolso y libera la franja', async () => {
  const client = await login('cliente@srrobot.com');
  const tech2 = store.technicians.find((t) => t.id === 2);
  const date = bookableDay();
  const service = tech2.services[0];
  const booked = await api('POST', '/appointments', { token: client, body: { technicianId: 2, serviceId: service.id, date, time: '09:00', mode: 'LOCAL', paymentMethod: 'CARD' } });
  assert.equal(booked.status, 201);
  const cancelled = await api('POST', `/appointments/${booked.body.data.appointment.id}/cancel`, { token: client, body: { reason: 'Ya no lo necesito' } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.refund.refunded, service.priceFrom);
  assert.equal(tech2.wallet.held, 0);
  assert.ok((await api('GET', `/technicians/2/availability?date=${date}`)).body.availableSlots.includes('09:00'));
});

test('cotizaciones: multi-técnico, etiquetas, aceptación y expiración', async () => {
  const client = await login('cliente@srrobot.com');
  const t1 = await login('tecnico@srrobot.com');
  const t2 = await login('tecnico2@srrobot.com');

  const req = await api('POST', '/quote-requests', {
    token: client, body: { deviceType: 'Celular', brandModel: 'iPhone 12', issueDescription: 'Pantalla rota', lat: 4.65, lng: -74.06, urgency: 'HIGH' }
  });
  assert.equal(req.status, 201);
  const request = req.body.data;
  assert.ok(request.matchedTechnicianIds.length >= 2 && request.matchedTechnicianIds.length <= 3);
  assert.ok(!request.matchedTechnicianIds.includes(5)); // técnico sin verificar

  const received = await api('GET', '/quote-requests/received?status=new', { token: t1 });
  assert.ok(received.body.data.some((r) => r.id === request.id));

  assert.equal((await api('POST', `/quote-requests/${request.id}/quotes`, { token: t1, body: { price: 200000, estimatedTime: '2 horas', warrantyDays: 60 } })).status, 201);
  assert.equal((await api('POST', `/quote-requests/${request.id}/quotes`, { token: t1, body: { price: 1, estimatedTime: '1 hora' } })).status, 409);
  assert.equal((await api('POST', `/quote-requests/${request.id}/quotes`, { token: t2, body: { price: 150000, estimatedTime: '1 día' } })).status, 201);

  const quotes = await api('GET', `/quote-requests/${request.id}/quotes`, { token: client });
  assert.equal(quotes.body.count, 2);
  const byPrice = quotes.body.data.find((q) => q.tags.includes('BEST_PRICE'));
  const fastest = quotes.body.data.find((q) => q.tags.includes('FASTEST'));
  assert.equal(byPrice.price, 150000);
  assert.equal(fastest.estimatedHours, 2);

  const accepted = await api('POST', `/quote-requests/${request.id}/quotes/${byPrice.id}/accept`, { token: client, body: { paymentMethod: 'DAVIPLATA' } });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.data.order.escrowStatus, 'HELD');
  assert.equal(accepted.body.data.order.amount, 150000);
  assert.equal((await api('POST', `/quote-requests/${request.id}/quotes/${fastest.id}/accept`, { token: client, body: { paymentMethod: 'NEQUI' } })).status, 409);

  // solicitud dirigida: solo ese técnico la recibe
  const direct = (await api('POST', '/quote-requests', { token: client, body: { deviceType: 'Laptop', brandModel: 'Dell', issueDescription: 'No enciende', targetTechnicianId: 3 } })).body.data;
  assert.deepEqual(direct.matchedTechnicianIds, [3]);

  // rechazo y expiración
  const t3 = await login('tecnico3@srrobot.com');
  assert.equal((await api('POST', `/quote-requests/${direct.id}/reject`, { token: t3 })).status, 200);
  assert.equal((await api('GET', '/quote-requests/received?status=rejected', { token: t3 })).body.data.length, 1);
  store.quoteRequests.find((r) => r.id === direct.id).expiresAt = new Date(Date.now() - 1000);
  const expired = await api('GET', `/quote-requests/${direct.id}/quotes`, { token: client });
  assert.equal(expired.body.status, 'EXPIRED');
});

test('subir fotos en la solicitud (multipart)', async () => {
  const client = await login('cliente@srrobot.com');
  const form = new FormData();
  form.append('deviceType', 'Consola');
  form.append('brandModel', 'PS5');
  form.append('issueDescription', 'No da video');
  form.append('isHomeService', 'true');
  form.append('media', new Blob([Buffer.from('fake-png')], { type: 'image/png' }), 'foto.png');
  const res = await fetch(`${base}/api/v1/quote-requests`, { method: 'POST', headers: { authorization: `Bearer ${client}` }, body: form });
  const json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.data.media.length, 1);
  assert.equal((await fetch(`${base}${json.data.media[0].url}`)).status, 200);

  const bad = new FormData();
  bad.append('deviceType', 'x'); bad.append('brandModel', 'x'); bad.append('issueDescription', 'x');
  bad.append('media', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe');
  assert.equal((await fetch(`${base}/api/v1/quote-requests`, { method: 'POST', headers: { authorization: `Bearer ${client}` }, body: bad })).status, 400);
});

test('chat: REST, no leídos y WebSocket en tiempo real', async () => {
  const client = await login('cliente@srrobot.com');
  const tech = await login('tecnico@srrobot.com');
  const conv = await api('POST', '/chat/conversations', { token: client, body: { technicianId: 1 } });
  assert.equal(conv.status, 201);
  const id = conv.body.data.id;
  assert.equal((await api('POST', '/chat/conversations', { token: client, body: { technicianId: 1 } })).body.data.id, id); // un hilo por par

  assert.equal((await api('POST', `/chat/conversations/${id}/messages`, { token: client, body: { text: 'Hola' } })).status, 201);
  assert.equal((await api('POST', `/chat/conversations/${id}/messages`, { token: client, body: { text: '' } })).status, 400);
  const list = await api('GET', '/chat/conversations', { token: tech });
  assert.equal(list.body.data.find((c) => c.id === id).unread, 1);
  assert.equal((await api('GET', `/chat/conversations/${id}/messages`, { token: tech })).body.data.length, 1);
  assert.equal((await api('GET', '/chat/conversations', { token: tech })).body.totalUnread, 0);
  const stranger = await login('tecnico2@srrobot.com');
  assert.equal((await api('GET', `/chat/conversations/${id}/messages`, { token: stranger })).status, 403);

  const wsBase = base.replace('http', 'ws');
  const wsTech = new WebSocket(`${wsBase}/chat/${id}?token=${tech}`);
  const received = new Promise((resolve, reject) => {
    wsTech.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'message') resolve(msg.data);
    });
    wsTech.on('error', reject);
  });
  await new Promise((resolve) => wsTech.on('open', resolve));
  const wsClient = new WebSocket(`${wsBase}/chat/${id}?token=${client}`);
  await new Promise((resolve) => wsClient.on('open', resolve));
  wsClient.send(JSON.stringify({ type: 'message', text: 'Mensaje por WS' }));
  assert.equal((await received).text, 'Mensaje por WS');
  wsTech.close();
  wsClient.close();

  const statusCode = await new Promise((resolve) => {
    const bad = new WebSocket(`${wsBase}/chat/${id}?token=${stranger}`);
    bad.on('error', () => {});
    bad.on('unexpected-response', (req, res) => resolve(res.statusCode));
  });
  assert.equal(statusCode, 403);
});

test('notificaciones: lista, leer y preferencias (WhatsApp con opt-in)', async () => {
  const tech = await login('tecnico@srrobot.com');
  const list = await api('GET', '/notifications', { token: tech });
  assert.ok(list.body.unreadCount > 0);
  assert.equal((await api('PATCH', `/notifications/${list.body.data[0].id}/read`, { token: tech })).status, 200);
  assert.equal((await api('POST', '/notifications/read-all', { token: tech })).status, 200);
  assert.equal((await api('GET', '/notifications?unread=true', { token: tech })).body.data.length, 0);
  assert.equal((await api('PUT', '/notifications/preferences', { token: tech, body: { whatsapp: true } })).body.data.whatsapp, true);
});

test('suscripciones, webhooks firmados e idempotentes', async () => {
  const tech = await login('tecnico2@srrobot.com');
  assert.equal((await api('GET', '/subscriptions/plans')).body.data.length, 3);
  assert.equal((await api('POST', '/subscriptions', { token: tech, body: { plan: 'PRO' } })).status, 400); // falta método de pago
  const sub = await api('POST', '/subscriptions', { token: tech, body: { plan: 'PRO', paymentMethod: 'NEQUI' } });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.data.plan, 'PRO');
  assert.equal(sub.body.data.subscription.status, 'ACTIVE');
  assert.equal((await api('GET', '/subscriptions/invoices', { token: tech })).body.data.length, 1);
  assert.equal((await api('POST', '/subscriptions', { token: tech, body: { plan: 'PRO', paymentMethod: 'NEQUI' } })).status, 409);

  const payload = JSON.stringify({ reference: sub.body.data.payment.reference, status: 'APPROVED' });
  assert.equal((await api('POST', '/payments/webhooks', { body: payload })).status, 401);
  assert.equal((await api('POST', '/payments/webhooks', { body: payload, headers: { 'x-signature': 'x'.repeat(64) } })).status, 401);
  const signature = crypto.createHmac('sha256', 'test_secret').update(payload).digest('hex');
  const hook = await api('POST', '/payments/webhooks', { body: payload, headers: { 'x-signature': signature } });
  assert.equal(hook.status, 200);
  assert.equal(hook.body.duplicate, true);

  const cancel = await api('DELETE', '/subscriptions/me', { token: tech });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.cancelAtPeriodEnd, true);
  assert.equal(store.technicians.find((t) => t.id === 2).plan, 'PRO'); // sigue vigente hasta fin de periodo
  store.subscriptions.find((s) => s.technicianId === 2 && s.status === 'ACTIVE').currentPeriodEnd = new Date(Date.now() - 1000);
  require('../src/services/reminderService').tick();
  assert.equal(store.technicians.find((t) => t.id === 2).plan, 'BASIC');
});

test('pago pendiente hasta el webhook (pasarela real)', async () => {
  const config = require('../src/config/env');
  const paymentService = require('../src/services/paymentService');
  config.payments.autoApprove = false;
  try {
    const client = await login('cliente@srrobot.com');
    const tech = store.technicians.find((t) => t.id === 4);
    const created = await api('POST', '/orders', { token: client, body: { technicianId: 4, serviceId: tech.services[0].id, paymentMethod: 'CARD' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.order.escrowStatus, 'PENDING');
    const { reference } = created.body.data.payment;
    assert.equal(tech.wallet.held, 0);
    paymentService.handleWebhook({ reference, status: 'APPROVED' });
    assert.equal(tech.wallet.held, tech.services[0].priceFrom);

    const declined = await api('POST', '/orders', { token: client, body: { technicianId: 4, serviceId: tech.services[0].id, paymentMethod: 'CARD' } });
    paymentService.handleWebhook({ reference: declined.body.data.payment.reference, status: 'DECLINED' });
    const o = await api('GET', `/orders/${declined.body.data.order.id}`, { token: client });
    assert.equal(o.body.data.state, 'CANCELADO');
  } finally {
    config.payments.autoApprove = true;
  }
});

test('repuestos: precio por plan, stock, envío y proveedor', async () => {
  const tech = await login('tecnico@srrobot.com'); // PRO: 10 %
  const supplier = await login('proveedor@srrobot.com');
  const products = (await api('GET', '/supplier/products?category=Pantallas', { token: tech })).body.data;
  assert.equal(products[0].price, 189000);
  assert.equal((await api('GET', '/supplier/products')).status, 401);

  assert.equal((await api('POST', '/supplier/orders', { token: tech, body: { items: [{ productId: products[0].id, quantity: 999 }], shippingAddress: 'x' } })).status, 409);
  const order = await api('POST', '/supplier/orders', { token: tech, body: { items: [{ productId: products[0].id, quantity: 2, price: 1 }], shippingAddress: 'Calle 1' } });
  assert.equal(order.status, 201);
  assert.equal(order.body.data.subtotal, 378000); // el precio del cliente se ignora
  assert.equal(order.body.data.shipping, 0); // envío gratis desde 200.000
  const small = await api('POST', '/supplier/orders', { token: tech, body: { items: [{ productId: 3, quantity: 1 }], shippingAddress: 'Calle 1' } });
  assert.equal(small.body.data.shipping, 12000);

  assert.equal((await api('PATCH', `/supplier/orders/${order.body.data.id}/status`, { token: tech, body: { status: 'SHIPPED' } })).status, 403);
  assert.equal((await api('PATCH', `/supplier/orders/${order.body.data.id}/status`, { token: supplier, body: { status: 'SHIPPED', trackingCode: 'TRK1' } })).status, 200);
  assert.equal((await api('PATCH', `/supplier/orders/${order.body.data.id}/status`, { token: supplier, body: { status: 'CANCELLED' } })).status, 400);

  assert.equal((await api('POST', '/supplier/products', { token: supplier, body: { name: 'Cable', category: 'Insumos', price: 5000, stock: 10 } })).status, 201);
  assert.equal((await api('POST', '/supplier/products', { token: tech, body: { name: 'x' } })).status, 403);
});

test('cuenta del cliente: direcciones, equipos, favoritos y tarjetas tokenizadas', async () => {
  const client = await login('cliente@srrobot.com');
  const a1 = await api('POST', '/client/addresses', { token: client, body: { address: 'Calle 10 # 5-5', label: 'Casa' } });
  const a2 = await api('POST', '/client/addresses', { token: client, body: { address: 'Calle 80', label: 'Oficina', isDefault: true } });
  const addresses = (await api('GET', '/client/addresses', { token: client })).body.data;
  assert.equal(addresses.filter((x) => x.isDefault).length, 1);
  assert.equal(addresses.find((x) => x.id === a2.body.data.id).isDefault, true);
  assert.equal((await api('DELETE', `/client/addresses/${a1.body.data.id}`, { token: client })).status, 200);

  const eq = await api('POST', '/client/equipments', { token: client, body: { type: 'Smartphones', brand: 'Apple', model: 'iPhone 13' } });
  assert.equal(eq.body.data.warranty.status, 'NONE');
  const tech2 = store.technicians.find((t) => t.id === 2);
  const o = await api('POST', '/orders', { token: client, body: { technicianId: 2, serviceId: tech2.services[0].id, paymentMethod: 'CASH', equipmentId: eq.body.data.id } });
  assert.equal(o.body.data.order.escrowStatus, 'CASH_ON_DELIVERY');
  const techToken = await login('tecnico2@srrobot.com');
  const step = (s) => api('POST', `/orders/${o.body.data.order.id}/transitions`, { token: techToken, body: { newState: s } });
  await step('DIAGNOSTICO'); await step('EN_REPARACION'); await step('LISTO');
  assert.equal((await api('POST', `/orders/${o.body.data.order.id}/confirm-receipt`, { token: client })).body.data.escrowStatus, 'CASH_COLLECTED');
  const equipments = (await api('GET', '/client/equipments', { token: client })).body.data;
  assert.equal(equipments[0].warranty.status, 'ACTIVE');
  assert.equal((await api('GET', '/client/warranties', { token: client })).body.data.length >= 1, true);

  assert.equal((await api('POST', '/client/favorites/1', { token: client })).status, 201);
  assert.equal((await api('GET', '/client/favorites', { token: client })).body.data[0].id, 1);
  assert.equal((await api('GET', '/technicians/1', { token: client })).body.data.isFavorite, true);

  assert.equal((await api('POST', '/client/payment-methods', { token: client, body: { type: 'CARD', gatewayToken: 't', cardNumber: '4111111111111111' } })).status, 400);
  const card = await api('POST', '/client/payment-methods', { token: client, body: { type: 'CARD', gatewayToken: 'tok_123', brand: 'VISA', last4: '4242' } });
  assert.equal(card.status, 201);
  assert.equal(card.body.data.gatewayToken, undefined);
});

test('disputa: cliente abre, admin resuelve con reembolso', async () => {
  const client = await login('cliente@srrobot.com');
  const tech = await login('tecnico3@srrobot.com');
  const admin = await login('admin@srrobot.com');
  const t3 = store.technicians.find((t) => t.id === 3);
  const date = bookableDay();
  const booked = await api('POST', '/appointments', { token: client, body: { technicianId: 3, serviceId: t3.services[0].id, date, time: '14:00', mode: 'LOCAL', paymentMethod: 'NEQUI' } });
  const orderId = booked.body.data.order.id;
  await api('POST', `/orders/${orderId}/transitions`, { token: tech, body: { newState: 'DIAGNOSTICO' } });

  assert.equal((await api('POST', `/orders/${orderId}/disputes`, { token: client, body: {} })).status, 400);
  const dispute = await api('POST', `/orders/${orderId}/disputes`, { token: client, body: { reason: 'No llegó el técnico', description: 'detalle' } });
  assert.equal(dispute.status, 201);
  assert.equal((await api('GET', `/orders/${orderId}`, { token: client })).body.data.state, 'DISPUTA');
  assert.equal((await api('POST', `/orders/${orderId}/cancel`, { token: client })).status, 400);
  assert.equal((await api('POST', `/disputes/${dispute.body.data.id}/comments`, { token: tech, body: { note: 'Sí fui' } })).status, 201);

  assert.equal((await api('GET', '/admin/disputes', { token: client })).status, 403);
  const list = await api('GET', '/admin/disputes?status=open', { token: admin });
  assert.ok(list.body.data.some((d) => d.id === dispute.body.data.id));
  const detail = await api('GET', `/admin/disputes/${dispute.body.data.id}`, { token: admin });
  assert.equal(detail.body.data.heldAmount, t3.services[0].priceFrom);
  assert.equal((await api('POST', `/admin/disputes/${dispute.body.data.id}/resolve`, { token: admin, body: { decision: 'REFUND_PARTIAL', amount: 0 } })).status, 400);
  const resolved = await api('POST', `/admin/disputes/${dispute.body.data.id}/resolve`, { token: admin, body: { decision: 'REFUND_FULL', note: 'Cliente tiene razón' } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.order.state, 'CANCELADO');
  assert.equal(resolved.body.data.order.escrowStatus, 'REFUNDED');
  assert.equal((await api('POST', `/admin/disputes/${dispute.body.data.id}/resolve`, { token: admin, body: { decision: 'RELEASE' } })).status, 409);
});

test('administración: verificación con documentos, moderación, configuración y métricas', async () => {
  const admin = await login('admin@srrobot.com');
  const tech5 = await login('tecnico5@srrobot.com');

  const form = new FormData();
  form.append('type', 'ID');
  form.append('documents', new Blob([Buffer.from('%PDF-1.4 fake')], { type: 'application/pdf' }), 'cedula.pdf');
  const up = await fetch(`${base}/api/v1/technicians/me/documents`, { method: 'POST', headers: { authorization: `Bearer ${tech5}` }, body: form });
  assert.equal(up.status, 201);
  const doc = (await up.json()).data[0];
  assert.equal(doc.file, undefined);

  const pending = await api('GET', '/admin/verifications', { token: admin });
  assert.ok(pending.body.data.some((t) => t.id === 5));
  const download = await fetch(`${base}/api/v1/admin/verifications/5/documents/${doc.id}`, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(download.status, 200);
  assert.equal((await fetch(`${base}/api/v1/admin/verifications/5/documents/${doc.id}`, { headers: { authorization: `Bearer ${tech5}` } })).status, 403);

  assert.equal((await api('POST', '/admin/verifications/5', { token: admin, body: { status: 'REJECTED' } })).status, 400); // exige motivo
  assert.equal((await api('POST', '/admin/verifications/5', { token: admin, body: { status: 'VERIFIED' } })).status, 200);
  assert.equal(store.technicians.find((t) => t.id === 5).isVerified, true);

  // moderación de reseñas recalcula el promedio y deja rastro
  const tech1 = store.technicians.find((t) => t.id === 1);
  const countBefore = tech1.reviewsCount;
  const review = store.reviews.find((r) => r.technicianId === 1 && !r.hidden);
  assert.equal((await api('POST', `/admin/reviews/${review.id}/hide`, { token: admin, body: {} })).status, 400);
  assert.equal((await api('POST', `/admin/reviews/${review.id}/hide`, { token: admin, body: { reason: 'Lenguaje abusivo' } })).status, 200);
  assert.equal(tech1.reviewsCount, countBefore - 1);
  assert.ok(!(await api('GET', '/technicians/1/reviews')).body.data.some((r) => r.id === review.id));

  const client = await login('cliente@srrobot.com');
  assert.equal((await api('POST', '/reports', { token: client, body: { targetType: 'REVIEW', targetId: review.id, reason: 'Spam' } })).status, 201);
  const reports = await api('GET', '/admin/reports?status=open', { token: admin });
  assert.equal((await api('POST', `/admin/reports/${reports.body.data[0].id}/resolve`, { token: admin, body: { status: 'RESOLVED' } })).status, 200);

  // configuración dinámica
  assert.equal((await api('PUT', '/admin/config', { token: admin, body: { commissions: { transactionRate: 5 } } })).status, 400);
  const cfg = await api('PUT', '/admin/config', { token: admin, body: { plans: { PRO: { price: 59900 } } } });
  assert.equal(cfg.body.data.plans.PRO.price, 59900);
  assert.equal((await api('GET', '/subscriptions/plans')).body.data.find((p) => p.code === 'PRO').price, 59900);
  assert.equal((await api('POST', '/admin/countries', { token: admin, body: { code: 'XX', name: 'Test', locale: 'es-XX', currency: 'XXX', paymentMethods: ['CARD'] } })).status, 201);
  assert.equal((await api('GET', '/config/countries/MX')).body.data.currency, 'MXN');

  const metrics = await api('GET', '/admin/metrics?city=Bogotá', { token: admin });
  assert.equal(metrics.status, 200);
  assert.ok(metrics.body.data.supply.verifiedTechnicians >= 4);
  const csv = await fetch(`${base}/api/v1/admin/metrics?format=csv`, { headers: { authorization: `Bearer ${admin}` } });
  assert.match(await csv.text(), /^metric,value/);
  assert.ok((await api('GET', '/admin/audit', { token: admin })).body.data.length >= 3);
});

test('perfil del técnico: servicios CRUD, horario, bloqueos y verificación', async () => {
  const reg = await api('POST', '/auth/register', {
    body: { name: 'Nuevo Tec', email: 'nuevo@tec.com', password: PASSWORD, role: 'TECHNICIAN', acceptTerms: true, categories: ['Audio'], lat: 4.61, lng: -74.08 }
  });
  assert.equal(reg.status, 201);
  const token = reg.body.data.token;

  assert.equal((await api('POST', '/technicians/me/submit-verification', { token })).status, 400);
  const svc = await api('POST', '/technicians/me/services', { token, body: { name: 'Revisión', priceFrom: 40000, estimatedTime: '1 hora' } });
  assert.equal(svc.status, 201);
  assert.equal((await api('POST', '/technicians/me/services', { token, body: { name: 'x', priceFrom: -5, estimatedTime: '1h' } })).status, 400);
  assert.equal((await api('PUT', `/technicians/me/services/${svc.body.data.id}`, { token, body: { priceFrom: 45000 } })).body.data.priceFrom, 45000);

  const date = bookableDay();
  assert.equal((await api('PUT', '/technicians/me/schedule', { token, body: { schedule: { mon: { open: '18:00', close: '08:00' } } } })).status, 400);
  assert.equal((await api('POST', '/technicians/me/blocks', { token, body: { date, start: '08:00', end: '12:00', reason: 'Vacaciones' } })).status, 201);
  const me = (await api('GET', '/technicians/me', { token })).body.data;
  const slots = (await api('GET', `/technicians/${me.id}/availability?date=${date}`)).body.slots;
  assert.ok(slots.filter((s) => s.time < '12:00').every((s) => !s.available));

  // sin verificar no puede recibir reservas
  const client = await login('cliente@srrobot.com');
  assert.equal((await api('POST', '/appointments', { token: client, body: { technicianId: me.id, serviceId: svc.body.data.id, date, time: '15:00', paymentMethod: 'NEQUI' } })).status, 409);

  assert.equal((await api('DELETE', `/technicians/me/services/${svc.body.data.id}`, { token })).status, 200);
  assert.equal((await api('GET', `/technicians/${me.id}`)).body.data.services.length, 0);
  assert.equal((await api('PUT', '/technicians/me', { token, body: { available: false } })).body.data.available, false);

  // modo dual cliente/técnico
  assert.equal((await api('POST', '/technicians/me/services', { token: client, body: {} })).status, 403);
  const switched = await api('POST', '/auth/switch-mode', { token: client, body: { role: 'TECHNICIAN' } });
  assert.equal(switched.status, 200);
  assert.equal((await api('GET', '/technicians/me', { token: switched.body.data.token })).status, 200);
});

test('privacidad: exportar datos y eliminar cuenta', async () => {
  const reg = await api('POST', '/auth/register', { body: { name: 'Borrar', email: 'borrar@test.com', password: PASSWORD, acceptTerms: true } });
  const token = reg.body.data.token;
  const exported = await api('GET', '/auth/me/export', { token });
  assert.equal(exported.body.data.user.email, 'borrar@test.com');
  assert.equal(exported.body.data.user.passwordHash, undefined);
  assert.equal((await api('DELETE', '/auth/me', { token, body: { password: 'incorrecta' } })).status, 401);
  assert.equal((await api('DELETE', '/auth/me', { token, body: { password: PASSWORD } })).status, 200);
  assert.equal((await api('GET', '/auth/me', { token })).status, 401);
});

import {test,expect} from '@playwright/test';
async function setup(page){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',route=>route.abort()); // no external traffic, including fonts
  await page.addInitScript(()=>{try{localStorage.setItem('saen-onboard-done','1');}catch{}});
  await page.goto('/app');await expect(page).toHaveURL(/\/app\/$/);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  return errors;
}
async function form(page){
  await page.evaluate(()=>{cart.toggle(0);openCheckout();});
  await page.locator('#btnNext').click();
  await page.locator('#formName').fill('Тестовый клиент');
  await page.locator('#formPhone').fill('+998 90 123 45 67');
  await page.locator('#formEmail').fill('test@example.com');
  await page.locator('#btnNext').click();
  await page.locator('#formAddress').fill('Ташкент, тестовая улица 1');
}
async function entries(page){return page.evaluate(()=>orderQueue.list());}
function accept(route){const o=route.request().postDataJSON();return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,accepted:true,orderId:o.id,total:o.total,notification:'sent',mode:'live'})});}
test('checkout confirms only after server acknowledgement and rapid clicks create one order',async({page})=>{
  const errors=await setup(page);let calls=0;
  await page.route('**/api/notify-order',async route=>{calls++;await accept(route);});
  await form(page);
  await page.evaluate(()=>{submitOrder();submitOrder();});
  await expect(page.locator('#confirmTitle')).toHaveText('Предзаказ принят сервером');
  expect(await entries(page)).toHaveLength(1);expect(calls).toBe(1);expect(errors).toEqual([]);
});
test('offline shell, cart and draft survive reload; reconnect submits the same saved order',async({page,context})=>{
  const errors=await setup(page);await form(page);
  await context.setOffline(true);await page.reload();
  await page.evaluate(()=>openCheckout());
  await page.locator('#btnNext').click();
  await expect(page.locator('#formName')).toHaveValue('Тестовый клиент');
  await page.locator('#btnNext').click();await expect(page.locator('#formAddress')).toHaveValue('Ташкент, тестовая улица 1');
  await page.locator('#btnNext').click();
  await expect(page.locator('#confirmTitle')).toContainText('Сохранён на устройстве');
  const saved=(await entries(page))[0];expect(saved.sync.status).toBe('queued');
  await page.reload();expect((await entries(page))[0].order.id).toBe(saved.order.id);
  let sent;await page.route('**/api/notify-order',async route=>{sent=route.request().postDataJSON();await accept(route);});
  await context.setOffline(false);
  await expect.poll(async()=>(await entries(page))[0].sync.status).toBe('accepted');
  expect(sent.id).toBe(saved.order.id);expect(errors).toEqual([]);
});
test('lost response persists pending order and recovery uses same ID',async({page})=>{
  const errors=await setup(page);const ids=[];
  await page.route('**/api/notify-order',async route=>{ids.push(route.request().postDataJSON().id);if(ids.length===1)await route.abort('failed');else await accept(route);});
  await form(page);await page.locator('#btnNext').click();
  await expect.poll(async()=>(await entries(page))[0]?.sync.code).toBe('NETWORK_ERROR');
  await page.reload();
  await expect.poll(async()=>(await entries(page))[0]?.sync.status,{timeout:30000}).toBe('accepted');
  expect(ids.length).toBe(2);expect(ids[0]).toBe(ids[1]);expect(errors).toEqual([]);
});
test('invalid email and failed storage retain form/cart and do not create an order',async({page})=>{
  const errors=await setup(page);let calls=0;await page.route('**/api/notify-order',route=>{calls++;return accept(route);});
  await form(page);await page.evaluate(()=>document.getElementById('formEmail').value='bad-email');
  await page.locator('#btnNext').click();await expect(page.locator('#checkoutError')).toContainText('Проверьте');expect(await entries(page)).toHaveLength(0);
  await page.evaluate(()=>{document.getElementById('formEmail').value='test@example.com';Storage.prototype.setItem=function(){throw new DOMException('Quota exceeded','QuotaExceededError');};});
  await page.locator('#btnNext').click();await expect(page.locator('#checkoutError')).toContainText('Не удалось сохранить');
  await expect(page.locator('#formName')).toHaveValue('Тестовый клиент');expect(await page.evaluate(()=>cart.count())).toBe(1);expect(calls).toBe(0);expect(errors).toEqual([]);
});
test('catalog conflict is visible and never auto-retried',async({page})=>{
  const errors=await setup(page);let calls=0;await page.route('**/api/notify-order',route=>{calls++;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,code:'CATALOG_CHANGED'})});});
  await form(page);await page.locator('#btnNext').click();await expect(page.locator('#confirmTitle')).toContainText('Цены изменились');
  await page.evaluate(()=>retryPendingOrders());expect(calls).toBe(1);expect(errors).toEqual([]);
});
test('legacy pending orders remain visible without resending; corrupt historical storage cannot break app',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('saen-orders',JSON.stringify([{id:'1234',items:[{brand:'<img src=x onerror=alert(1)>',name:'Legacy'}],total:1,createdAt:Date.now(),delivery:{type:'pickup'},editFull:'Hifz',_notified:false}])));
  const errors=await setup(page);let calls=0;await page.route('**/api/notify-order',route=>{calls++;return accept(route);});
  await expect(page.locator('#orders-content')).toContainText('Заказ старой версии');expect(await page.locator('#orders-content img').count()).toBe(0);
  await page.evaluate(()=>{localStorage.setItem('saen-orders','{}');renderOrders();});expect(calls).toBe(0);expect(errors).toEqual([]);
});

test('denied localStorage leaves catalog usable and blocks unsaved checkout',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.getItem=function(){throw new DOMException('Denied','SecurityError');};Storage.prototype.setItem=function(){throw new DOMException('Denied','SecurityError');};});
  const errors=await setup(page);
  await page.evaluate(()=>{document.getElementById('onboardOverlay')?.classList.remove('show');document.querySelectorAll('.onboard-overlay').forEach(e=>e.remove());});
  await page.evaluate(()=>{cart.toggle(0);openCheckout();document.getElementById('formName').value='Тестовый клиент';document.getElementById('formPhone').value='+998901234567';selectDelivery('pickup');submitOrder();});
  await expect(page.locator('#checkoutError')).toContainText('Не удалось сохранить');expect(errors).toEqual([]);
});

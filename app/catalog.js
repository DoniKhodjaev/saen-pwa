// Single price source for the browser and the server. Bump version on any price/availability change.
(() => {
const products = [
  {
    n: 'I', brand: 'Augustinus Bader', name: 'The Rich Cream',
    cat: 'Skincare', size: '15 ml · travel', priceUzs: 1887000, price: '1 887 000 сум',
    desc: 'Хитовый премиум-крем последних двух лет. Густая, восстанавливающая текстура для холодного сезона. Один из немногих продуктов с реальной клинической доказательной базой.',
    ingredients: ['<b>TFC8&#174;</b> — патентованный комплекс из 40+ молекул', 'Evening primrose oil — восстановление барьера', 'Avocado oil — омега-6 для эластичности'],
    texture: 'Густой soufflé-cream, тает в плотную плёнку, впитывается за 2–3 минуты. Без отдушек. Утром и вечером, по 2 нажатия.',
    forWhom: ['Сухая, обезвоженная кожа', '30+ с признаками старения', 'Холодный сезон, отопительный период'],
    origin: 'Германия · Привозим из Sephora Middle East. Документы об оригинальности прикладываем к заказу.'
  },
  {
    n: 'II', brand: 'Sulwhasoo', name: 'First Care Activating Serum',
    cat: 'Skincare', size: '30 ml', priceUzs: 1690000, price: '1 690 000 сум',
    desc: 'Корейская династическая формула 1997 года на основе традиционных трав. Подготавливает кожу к восприятию остального ухода — наносится первым шагом.',
    ingredients: ['JAUM Balancing Complex — пять корейских трав', 'Pine mushroom extract', 'White lily — выравнивание тона'],
    texture: 'Лёгкая, чуть маслянистая эссенция. 1–2 капли в ладонь, прикладывается к лицу. Не липкая, впитывается мгновенно.',
    forWhom: ['Все типы кожи, особенно тусклая', 'Регулярное использование утром и вечером', 'Знакомство с K-beauty уходом'],
    origin: 'Южная Корея · Привозим из официального Sulwhasoo boutique в Dubai Mall.'
  },
  {
    n: 'III', brand: 'SK-II', name: 'Facial Treatment Essence',
    cat: 'Skincare', size: '75 ml', priceUzs: 2287000, price: '2 287 000 сум',
    desc: 'Легендарная Pitera эссенция, открытая в 1980-х в японской саке-варне. Более 50 микронутриентов, поддерживающих естественное обновление кожи.',
    ingredients: ['<b>Pitera</b> — ферментированный галактомицес (90%+)', 'Аминокислоты — питание', 'Органические кислоты — мягкое обновление'],
    texture: 'Прозрачная водянистая эссенция с лёгким ароматом ферментации. 4–5 капель, похлопывающими движениями. Утром и вечером.',
    forWhom: ['Тусклая, неровная по тону кожа', '25+, профилактика старения', 'Любители японского skincare'],
    origin: 'Япония · Привозим из Sephora Middle East. Запах ферментации — норма.'
  },
  {
    n: 'IV', brand: 'Drunk Elephant', name: 'Lala Retro Whipped Cream',
    cat: 'Skincare', size: '50 ml', priceUzs: 1391000, price: '1 391 000 сум',
    desc: 'Восстановление барьера с использованием шести экзотических масел. Виральный продукт в TikTok skincare-сегменте. Философия «6 free».',
    ingredients: ['Шесть масел: marula, mongongo, baobab и др.', 'Ceramide complex — восстановление барьера', 'Niacinamide — успокаивание'],
    texture: 'Кремово-взбитая консистенция, переходит в шёлковую плёнку. Не оставляет жирного блеска. Вечером, в холодный сезон — и утром.',
    forWhom: ['Сухая и очень сухая кожа', 'Нарушенный барьер', 'Любители clean beauty без silicones'],
    origin: 'США · Привозим из Sephora Middle East.'
  },
  {
    n: 'V', brand: 'Diptyque', name: 'Baies — свеча',
    cat: 'Home', size: '70 g · 25 часов', priceUzs: 894000, price: '894 000 сум',
    desc: 'Создана в 1968 году — одна из первых свечей Diptyque и до сих пор самая продаваемая. Аромат чёрной смородины и болгарской розы.',
    ingredients: ['Натуральный воск', 'Хлопковый фитиль', 'Чёрная смородина (top)', 'Болгарская роза (heart)'],
    texture: 'Горит ровным пламенем без копоти. Аромат наполняет комнату через 10–15 минут. Перед первым зажжением — час горения для ровного воска.',
    forWhom: ['Любители читать дома со свечой', 'Универсальный подарок', 'Создание atmosphere для встреч'],
    origin: 'Франция · Производство в Бретани. Привозим из Diptyque boutique в Dubai Mall.'
  },
  {
    n: 'VI', brand: 'Byredo', name: 'Mojave Ghost',
    cat: 'Fragrance', size: '50 ml · EDP', priceUzs: 3974000, price: '3 974 000 сум',
    desc: 'Создан Беном Горэмом в 2014 году. Самый продаваемый аромат Byredo всех времён. Унисекс. Назван в честь цветка пустыни Мохаве.',
    ingredients: ['<b>Top:</b> Sapodilla, Ambrette', '<b>Heart:</b> Magnolia, Violet, Sandalwood', '<b>Base:</b> Cedarwood, Vetiver, Musk'],
    texture: 'Открывается фруктово-древесными нотами, через 20 минут — тёплая sandalwood-база. Стойкость 6–8 часов. Шлейф мягкий, близкая аура.',
    forWhom: ['Любители унисекс ароматов', 'Те, кто не хочет «громкий» парфюм', 'Поиск signature scent'],
    origin: 'Швеция · Создан в Стокгольме, разлив в Италии. Привозим из Boutique 1 в Dubai.'
  },
  {
    n: 'VII', brand: 'Aesop', name: 'Resurrection Hand Balm',
    cat: 'Body', size: '75 ml', priceUzs: 695000, price: '695 000 сум',
    desc: 'Самый продаваемый продукт Aesop. Подходит как первое знакомство с брендом. Густой, ароматный, с травяной нотой rosemary, mandarin и cedar.',
    ingredients: ['Mandarin Rind — освежающий цитрус', 'Rosemary Leaf — травяная теплота', 'Shea Butter — питание'],
    texture: 'Плотный крем средней густоты. Не оставляет жирного следа. Аромат держится около часа. Капля растирается между ладонями.',
    forWhom: ['Знакомство с миром Aesop', 'Популярный подарок', 'Сухие руки после частого мытья'],
    origin: 'Австралия · Производство в Мельбурне. Привозим из Aesop boutique в The Dubai Mall.'
  }
];
products.forEach(Object.freeze);
globalThis.SaenCatalog = Object.freeze({
  version: 'hifz-2026-10-19', edit: 'Edit N°I — Hifz', deliveryFeeUzs: 0,
  products: Object.freeze(products),
});
})();

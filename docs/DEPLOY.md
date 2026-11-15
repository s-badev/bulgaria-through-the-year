`# Публикуване
`
`Статичен сайт: няма сървър, функции, база или променливи на средата. `npm run build` дава папка `dist/` (около 9 MB, 44 файла).
`
`## Vercel: само Import
`
`1. vercel.com → **Add New… → Project** → избери GitHub хранилището `bulgaria-through-the-year` (при първо влизане дай на Vercel достъп до него).
`2. Настройки (`vercel.json` ги задава сам, но провери, че диалогът показва същото):
`
`| Поле | Стойност |
`|---|---|
`| Framework Preset | **Vite** |
`| Root Directory | `./` (по подразбиране) |
`| Build Command | `npm run build` |
`| Output Directory | `dist` |
`| Install Command | `npm ci` |
`| Node.js Version | **24.x** (или 22.x; Vite 8 иска най-малко 20.19, в `package.json` е `engines: >=20.19`) |
`| Environment Variables | **няма** |
`
`3. **Deploy**. Билдът отнема около минута и не изтегля нищо освен npm пакетите.
`
`Незадължително: ако има собствен домейн, добави променлива `SITE_URL=https://твоят-домейн` (без наклонена черта накрая). Тя е нужна само за абсолютния адрес в Open Graph и Twitter картата; без нея таговете сочат към `/og-image.jpg`. На `*.vercel.app` Vercel сама подава `VERCEL_PROJECT_PRODUCTION_URL` и адресът излиза абсолютен без нищо.
`
`## Какво прави \`vercel.json\`
`
`- \`/assets/*\` и \`/scenes/*\`: \`Cache-Control: public, max-age=31536000, immutable\`. Безопасно е, защото файловете в \`assets/\` са с хеш в името, а файловете на сцената се зареждат с \`?v=<хеш на съдържанието на папката>\` (изчислява се при билда).
`- \`index.html\`: \`max-age=0, must-revalidate\`, за да се виждат новите версии веднага.
`- \`X-Content-Type-Options\`, \`Referrer-Policy\`, \`Permissions-Policy\` (камера, микрофон, геолокация, плащане: изключени).
`
`## След първия deploy: бърза проверка
`
`1. Отвори адреса: снимката се зарежда, футърът показва версия, равна на първите 7 знака на комита.
`2. „Сега“ работи (иска мрежа към api.open-meteo.com).
`3. \`curl -I https://адрес/scenes/ndk/scene.json?v=x\` показва \`cache-control: public, max-age=31536000, immutable\`.
`4. Постави адреса в чат или във Facebook/LinkedIn Sharing Debugger: картата е 1200×630.
`
`## Преди хранилището да стане публично
`
`1. **Имейл в историята.** Всичките комити са с автор „Stefan Badev“ и личния имейл от глобалната git конфигурация. Частно хранилище е безопасно; публично показва този имейл на всички. Ако не го искаш: настрой \`git config user.email\` към GitHub „no-reply“ адреса от Settings → Emails, пренапиши историята (\`git filter-repo --mailmap\` или \`git rebase --root\` с \`--exec\`) и пусни \`git push --force-with-lease\` към още празно за други хора хранилище.
`2. **Снимките.** Публично хранилище значи, че всеки може да изтегли \`public/scenes/**\` (както и от самия сайт). \`LICENSE\` ги резервира юридически, не технически. Ако не искаш това, остави хранилището частно: Vercel импортира и частни хранилища.
`3. **Притежател в \`LICENSE\`** е „Chefo“. Смени го с името, което искаш да стои.
`4. **Open-Meteo**: безплатният API е за некомерсиална употреба; при комерсиален сайт трябва платен план.
`5. Включи в GitHub → Settings → Code security: secret scanning и push protection.

# KEYxMASTER — Railway setup (simple)

Yeh project original command logic ko change nahi karta. `commands.bundle.json`
mein same TeleBotHost/BJS command files bundled hain; `main.js` Railway runtime
provide karta hai.

## Sabse easy method: GitHub se Railway deploy

Final compact package mein GitHub par upload karne ke liye sirf ye files hain:

```text
main.js
main.py
commands.bundle.json
package.json
package-lock.json
railway.json
.env.example
README_RAILWAY.md
```

In files ko GitHub repository ke **root** mein upload karein. Kisi extra
`railway_bot/railway_bot/` folder ke andar mat rakhein. `commands.bundle.json`
ke andar original ke saare 132 command files bundled hain, isliye 100-file
upload limit ka issue nahi aayega.

### Railway par deploy

1. Is folder ko GitHub repository ke root ke roop mein upload karein.
2. Railway mein **New Project → Deploy from GitHub Repo** select karein.
3. Variable add karein:

   `BOT_TOKEN` = BotFather se mila Telegram bot token

   `ADMIN_ID` = `7088682169`

   `ZAP_KEY` = aapka ZAP key

4. Railway automatically `npm install` aur `npm start` chalayega.
5. Deploy logs mein `Loaded ... command aliases` dikhna chahiye.

Railway mein **Start Command manually set karne ki zaroorat nahi** hai. Agar
set karna ho to exact command:

```text
npm start
```

`main.py` optional helper hai. Python se manually chalana ho to:

```text
python3 main.py
```

Lekin Railway deployment ke liye `npm start` hi recommended hai, kyunki bot ka
original code JavaScript mein bana hua hai.

`security.json` jaan-bujhkar output mein nahi rakha gaya. Us file ka token
Railway par upload na karein. `PAYMENT_API_KEY`, `RESELLER_API_KEY` aur
`RESELLER_MASTER_KEY` optional fallback variables hain—agar aap admin commands
se values save karte hain to inki zaroorat nahi hai. Bot database values ko
environment variables se pehle priority deta hai.

## Telegram se admin configuration

Payment gateway:

`/set_payment_upi yourid@fam|PAYMENT_API_KEY`

Sirf UPI badalna ho to:

`/set_payment_upi yourid@fam`

Reseller API:

`/apiadd ID | NAME | URL | API_KEY | MASTER_KEY | reseller_v1 | false`

Example ke baad API active karne ke liye:

`/apiset ID`

Existing API credentials update karne ke liye:

`/apiupdate ID | api_key | NEW_API_KEY`

In commands ko owner ya authorized co-admin hi chala sakta hai. Credentials
`data/store.json` mein save honge, isliye production mein Railway Volume
recommended hai.

## Data persistence

Bot ka property, user state aur balance `data/store.json` mein save hota hai.
Railway ke normal filesystem par redeploy ke baad yeh file reset ho sakti hai.
Permanent data ke liye Railway Volume mount karke:

`DATA_FILE_PATH=/data/store.json`

set karein. Production payments/stock ke liye external database ya Railway
Postgres ko later add karna better rahega.

## Important

Railway ko `main.py` ki zaroorat nahi hai, kyunki yeh export JavaScript runtime
par bana hai. Isliye correct entrypoint `main.js` hai. Python mein rewrite karne
par 130+ command files ki logic dobara translate karni padti, jisse bot ka
existing behavior aur style unnecessarily badal jata.
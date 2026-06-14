const fs = require('fs')
const path = require('path')

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')
const cryptoJs = fs.readFileSync(path.join(__dirname, 'crypto-utils.js'), 'utf8')

let combined = html
  .replace('<script src="crypto-utils.js"></script>', `<script>${cryptoJs}</script>`)
  .replace('<script src="app.js"></script>', `<script>${appJs}</script>`)

const output = `export const FRONTEND_HTML = ${JSON.stringify(combined)}
`

fs.writeFileSync(path.join(__dirname, '..', 'src', 'frontend.js'), output)
console.log('Frontend generated: frontend.js (' + (combined.length / 1024).toFixed(1) + ' KB)')

const http = require('http')
const path = require('path')
const express = require('express')
const session = require('express-session')
const SessionDB = require('level-session-store')(session)
const bodyParser = require('body-parser')
const level = require('level')
const natural = require('natural')
const uuid = require('uuid')
const sanitize = require('sanitize-html')
const concat = require('concat-stream')

const tokenizer = new natural.WordTokenizer()

const db = level('./db/messages', {
  createIfMissing: true,
  valueEncoding: 'json'
})

const sess = session({
  store: new SessionDB('./db/sessions'),
  secret: process.env.SESSION
})

const app = express()

app.set('view engine', 'pug')
app.set('views', path.join(__dirname, 'views'))
app.use(sess)
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, '/public')))

const server = http.createServer(app)
server.listen(process.env.PORT || 3000)

app.get('/', (req, res) => {
  const rs = db.createValueStream({
    gte: 'message~',
    lte: 'message~\xff',
    limit: 50
  })

  rs.pipe(concat((messages) => {
    console.log('msgs: ', messages)
    res.render('index', {
      messages: messages,
      tag: ''
    })
  }))

  rs.on('error', (err) => {
    console.log('Tag page error: ', err)
  })
})

app.get('/tag/:tag', (req, res) => {
  const tag = req.params.tag.toLowerCase()
  const rs = db.createValueStream({
    gte: 'tagged~' + tag + '~',
    lte: 'tagged~' + tag + '~\xff',
    limit: 50
  })

  rs.pipe(concat((messages) => {
    res.render('index', {
      tag: tag,
      messages: messages
    })
  }))

  rs.on('error', (err) => {
    console.log('Tag page error: ', err)
  })
})

app.post('/post', (req, res) => {
  const mId = uuid.v4()
  const message = sanitize(req.body.message.trim())
  const tags = tokenizer.tokenize(message)

  const taggedMsg = tags.map((tag) => {
    return '<a href="/tag/' + encodeURIComponent(tag.toLowerCase()) + '">' + tag + '</a> '
  })

  let batch = [
    {
      type: 'put',
      key: 'message~' + mId + '~' + Date.now(),
      value: {
        original: message,
        tagged: taggedMsg,
        created: Date.now()
      }
    }
  ]

  tags.map((tag) => {
    batch.push({
      type: 'put',
      key: 'tagged~' + tag.toLowerCase() + '~' + mId + '~' + Date.now(),
      value: {
        original: message,
        tagged: taggedMsg,
        created: Date.now()
      }
    })
  })

  db.batch(batch, (err) => {
    if (err) {
      console.log('DATABASE SAVE ERROR: ', err)
    }

    res.redirect('/')
  })
})

const http = require('http')
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const level = require('level')
const uuid = require('uuid')
const concat = require('concat-stream')

const db = level('./db/messages', {
  createIfMissing: true,
  valueEncoding: 'json'
})

const app = express()

app.set('view engine', 'pug')
app.set('views', path.join(__dirname, 'views'))
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
  const message = req.body.message.trim()
  let media = req.body.media && req.body.media.trim()

  if (!media.match(/^https:\/\/\w*\.giphy\.com/i)) {
    media = ''
  }

  const tags = message.split(' ').map((tag) => {
    return {
      tag: tag.replace(/[^A-Z0-9_-]+/gi, '').toLowerCase(),
      text: tag.replace(/>+/gi, '&gt;').replace(/<+/gi, '&lt;').replace(/"+/gi, '&quot;')
    }
  })

  const taggedMsg = tags.map((tag, idx) => {
    return '<a href="/tag/' + encodeURIComponent(tag.tag) + '">' + tag.text + '</a>'
  })

  if (message.length && tags.length) {
    let batch = [
      {
        type: 'put',
        key: 'message~' + mId + '~' + Date.now(),
        value: {
          original: message,
          tagged: taggedMsg,
          media: media || '',
          created: Date.now()
        }
      }
    ]

    tags.map((tag) => {
      batch.push({
        type: 'put',
        key: 'tagged~' + tag.tag.toLowerCase() + '~' + mId + '~' + Date.now(),
        value: {
          original: message,
          tagged: taggedMsg,
          media: media || '',
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
  } else {
    console.log('nothing saved')
    res.redirect('/')
  }
})

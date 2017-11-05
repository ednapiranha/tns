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
server.listen(process.env.PORT || 8000)

app.get('/', (req, res) => {
  const rs = db.createReadStream({
    gte: 'feed~',
    lte: 'feed~\xff',
    limit: 50,
    reverse: true
  })

  rs.pipe(concat((messages) => {
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
  const tag = req.params.tag.trim().toLowerCase()
  const rs = db.createReadStream({
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

app.get('/m/:key', (req, res) => {
  const key = req.params.key.trim().split('~').reverse().join('~')

  db.get('message~' + key, (err, m) => {
    if (err) {
      res.redirect('/')
    } else {
      console.log(key)

      ///////////////////
      console.log(m)
      const message = m.original
      const tags = message.split(' ').map((tag) => {
        const tagStr = tag.replace(/[^A-Z0-9_-]+/gi, '').toLowerCase()

        if (tagStr.length) {
          return {
            tag: tagStr,
            text: tag.replace(/>+/gi, '&gt;').replace(/<+/gi, '&lt;').replace(/"+/gi, '&quot;')
          }
        } else {
          return {
            tag: '',
            text: tag.replace(/>+/gi, '&gt;').replace(/<+/gi, '&lt;').replace(/"+/gi, '&quot;')
          }
        }
      })
      console.log('&&&&&&&&& ', tags)
      const taggedMsg = tags.map((tag, idx) => {
        if (tag.tag.length) {
          if (tag.tag.match(/^http/gi)) {
            return '<a href="' + tag.text + '" class="outlink">' + tag.text + '</a>'
          } else {
            return '<a href="/tag/' + encodeURIComponent(tag.tag) + '">' + tag.text + '</a>'
          }
        } else {
          return '<span>' + tag.text + '</span>'
        }
      })
      console.log('======> ', message, taggedMsg)
      if (message.length && tags.length) {
        let batch = [
          {
            type: 'put',
            key: 'message~' + key,
            value: {
              original: message,
              tagged: taggedMsg,
              media: m.media,
              created: m.created
            }
          },
          {
            type: 'put',
            key: 'feed~' + m.created + '~' + key.split('~')[0],
            value: {
              original: message,
              tagged: taggedMsg,
              media: m.media,
              created: m.created
            }
          }
        ]

        tags.map((tag) => {
          if (tag.tag.length) {
            batch.push({
              type: 'put',
              key: 'tagged~' + tag.tag.toLowerCase() + '~' + key,
              value: {
                original: message,
                tagged: taggedMsg,
                media: m.media,
                created: Date.now()
              }
            })
          }
        })

        db.batch(batch, (err) => {
          if (err) {
            console.log('DATABASE SAVE ERROR: ', err)
          }

          //res.redirect('/')
        })
      }

      ///////////////////

      res.render('index', {
        tag: '',
        messages: [{
          key: 'message~' + key,
          value: m
        }]
      })
    }
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
    const tagStr = tag.replace(/[^A-Z0-9_-]+/gi, '').toLowerCase()

    if (tagStr.length) {
      return {
        tag: tagStr,
        text: tag.replace(/>+/gi, '&gt;').replace(/<+/gi, '&lt;').replace(/"+/gi, '&quot;')
      }
    } else {
      return {
        tag: '',
        text: tag.replace(/>+/gi, '&gt;').replace(/<+/gi, '&lt;').replace(/"+/gi, '&quot;')
      }
    }
  })

  const taggedMsg = tags.map((tag, idx) => {
    if (tag.tag.length) {
      if (tag.tag.match(/^http/gi)) {
        return '<a href="' + tag.text + '" class="outlink">' + tag.text + '</a>'
      } else {
        return '<a href="/tag/' + encodeURIComponent(tag.tag) + '">' + tag.text + '</a>'
      }
    } else {
      return '<span>' + tag.text + '</span>'
    }
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
      },
      {
        type: 'put',
        key: 'feed~' + Date.now() + '~' + mId,
        value: {
          original: message,
          tagged: taggedMsg,
          media: media || '',
          created: Date.now()
        }
      }
    ]

    tags.map((tag) => {
      if (tag.tag.length) {
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
      }
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

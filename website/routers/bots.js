const express = require('express');
const { isOwner, isLoggedIn, isAdmin } = require('../static/middleware');
const schema = require('../schemas/bots');
const joi = require('../schemas/joi');
const { unflatten } = require('flat');
const multer = require('multer');
const r = require('../rethinkdb');
const config = require('../config');
const marked = require('marked');
const xss = require('../static/xss');
const ImageCache = require('../class/ImageCache');
const crypto = require('crypto');
const discordWebhooks = require('../static/discordWebhook');
const fetch = require('node-fetch');
const { localise, listMiddleware } = require('../static/list');

const router = express.Router();
const reader = multer();

const selectableLanguages = Object.keys(config.languages).sort((a, b) => {
  if (config.languages[a].top) {
    return -1;
  } else if (config.languages[b].top) {
    return 1;
  } else if (a < b) {
    return -1;
  } else if (a > b) {
    return 1;
  }
  return 0;
});

router
  .get('/', listMiddleware({
    filter: {
      verified: true
    }
  }))
  .get('/unverified', listMiddleware({
    filter: {
      verified: false
    }
  }))
  .get('/search', listMiddleware({
    filter: 'search'
  }))
  .get('/by/:id', listMiddleware({
    filter: 'owner'
  }))
  .get('/category/:category', listMiddleware({
    filter: 'category'
  }))
  .get('/:id', (req, res, next) => {
    r.table('bots')
      .get(req.params.id)
      .merge(bot => ({
        authors: r.table('users').getAll(r.args(bot('authors'))).coerceTo('array'),
        reviews: r.table('reviews')
          .filter(review => review('bot').eq(bot('id')))
          .merge(review => ({
            author: r.table('users').get(review('author'))
          }))
          .sample(5)
          .coerceTo('array'),
        ratings: r.table('reviews')
          .group('rating')
          .filter(review => review('bot').eq(bot('id')))
          .count()
          .ungroup()
      }))
      .default(null)
      .then((item) => {
        if (!item) {
          next();
        } else {
          const bot = localise(item, req);
          const ratings = {};
          const numberOfRatings = bot.ratings.reduce((sum, rating) => sum + rating.reduction, 0);
          const maximumNumber = bot.ratings.reduce((max, rating) => {
            if (rating.reduction > max) {
              return rating.reduction;
            }
            return max;
          }, 0);

          // The maximum rating is 5.
          // Loop from 1 to including 5
          for (let i = 1; i <= 5; i += 1) {
            const rating = bot.ratings.find(groupedRating => groupedRating.group === i);

            if (rating) {
              ratings[i] = {
                count: rating.reduction,
                proportion: rating.reduction / numberOfRatings,
                percentage: (rating.reduction / numberOfRatings) * 100,
                sliderWidth: (rating.reduction / maximumNumber) * 100
              };
            } else {
              ratings[i] = {
                count: 0,
                proportion: 0,
                percentage: 0,
                sliderWidth: 0
              };
            }
          }

          marked.setOptions({
            sanitize: !item.legacy
          });

          const contents = xss[item.legacy ? 'lenient' : 'strict'](marked(bot.contents.page));
          res.render('bot', {
            item: bot,
            contents,
            canEdit: req.user ? bot.authors.some(owner => owner.id === req.user.id) || req.user.admin : false,
            cover: bot.cachedImages ? bot.cachedImages.cover : null,
            edited: (new Date(item.edited)).toLocaleDateString(req.getLocale(), config.dateformat),
            created: (new Date(item.created)).toLocaleDateString(req.getLocale(), config.dateformat),
            description: bot.contents.description || '',
            avatar: bot.cachedImages ? bot.cachedImages.avatar : null,
            title: bot.contents.name,
            ratings,
            numberOfRatings
          });
        }
      })
      .catch((err) => {
        next(err);
      });
  })
  .get('/:id/edit', isLoggedIn, (req, res, next) => {
    r.table('bots')
      .get(req.params.id)
      .then((item) => {
        if (item) {
          const remainingLanguages = selectableLanguages.filter(language => !Object.keys(item.contents).includes(language));
          res.render('add', {
            selectableLanguages: remainingLanguages,
            categories: config.categories,
            item,
            layout: 'docs',
          });
        } else {
          next();
        }
      })
      .catch((err) => {
        next(err);
      });
  })
  .get('/:id/delete', isLoggedIn, (req, res) => {
    res.render('sure');
  })
  .post('/:id/delete', (req, res, next) => {
    r.table('bots')
      .get(req.params.id)
      .then((existingBot) => {
        if (existingBot) {
          if (existingBot.authors.includes(req.user.id) || req.user.admin) {
            r.table('bots')
              .get(req.params.id)
              .delete()
              .then(() => {
                res.redirect('/');
                discordWebhooks(`<@${req.user.id}> deleted <@${req.params.id}>`);
              })
              .catch((err) => {
                next(err);
              });
          } else {
            res.json({
              ok: false,
              message: res.__('bot_exists_error')
            });
          }
        } else {
          next();
        }
      })
      .catch((err) => {
        next(err);
      });
  })
  .get('/:id/configure', isOwner, (req, res, next) => {
    r.table('bots')
      .get(req.params.id)
      .then((item) => {
        if (item) {
          res.render('configure', {
            item
          });
        } else {
          next();
        }
      })
      .catch((err) => {
        next(err);
      });
  })
  .post('/:id/token', isOwner, (req, res, next) => {
    r.table('bots')
      .update({
        id: req.params.id,
        token: crypto.randomBytes(20).toString('hex')
      })
      .then(() => {
        res.redirect(`/bots/${req.params.id}/configure`);
      })
      .catch((err) => {
        next(err);
      });
  })
  .post('/:id/hide', isOwner, (req, res, next) => {
    r.table('bots')
      .get(req.params.id)
      .update({
        hide: r.row('hide').not()
      })
      .then(() => {
        res.redirect(`/bots/${req.params.id}/configure`);
      })
      .catch((err) => {
        next(err);
      });
  })
  .post('/:id/approve', isAdmin, (req, res, next) => {
    r.table('bots')
      .get(req.params.id)
      .update({
        verified: true
      })
      .then((result) => {
        if (result.replaced === 1) {
          discordWebhooks(`<@${req.user.id}> approved <@${req.params.id}>`);
        }
        res.redirect('/bots/unverified');
      })
      .catch((err) => {
        next(err);
      });
  })
  .get('/:id/deny', isAdmin, (req, res) => {
    res.render('sure', {
      reason: true
    });
  })
  .post('/:id/deny', isAdmin, (req, res, next) => {
    r.table('bots')
      .get(req.params.id)
      .delete()
      .then(() => {
        discordWebhooks(`<@${req.user.id}> denied <@${req.params.id}>\n${req.body.reason}`);
        res.redirect('/bots/unverified');
      })
      .catch((err) => {
        next(err);
      });
  })
  .get('/add', isLoggedIn, (req, res) => {
    res.render('add', {
      selectableLanguages,
      categories: config.categories,
      layout: 'docs',
      item: {},
    });
  })
  .post('/add', isLoggedIn, reader.none(), (req, res, next) => {
    const body = unflatten(req.body);

    joi.validate(body.bot, schema, {
      abortEarly: true
    }, (err, value) => {
      if (err) {
        res.json({
          ok: false,
          message: res.__(err.message)
        });
      } else {
        const insert = (type, message, avatar) => {
          const imagePromises = [];
          value.cachedImages = {
            avatar: null,
            cover: null,
            preview: [],
          };

          if (value.images && typeof value.images.avatar === 'string') {
            const cache = new ImageCache(value.images.avatar, 512, 512, value.nsfw);
            imagePromises.push(cache.cache());
            value.cachedImages.avatar = cache.permalink;
          } else if (avatar) {
            const cache = new ImageCache(`https://cdn.discordapp.com/avatars/${value.id}/${avatar}.png`, 512, 512, value.nsfw);
            imagePromises.push(cache.cache());
            value.cachedImages.avatar = cache.permalink;
          } else {
            value.cachedImages.avatar = '/img/logo/logo.svg';
          }

          if (value.images && typeof value.images.cover === 'string') {
            const cache = new ImageCache(value.images.cover, 1280, 720, value.nsfw);
            imagePromises.push(cache.cache());
            value.cachedImages.cover = cache.permalink;
          }

          if (value.images && Array.isArray(value.images.preview)) {
            for (let i = 0; i < value.images.preview.length; i += 1) {
              if (typeof value.images.preview[i] === 'string') {
                const cache = new ImageCache(value.images.preview[i], 1280, 720, value.nsfw);
                imagePromises.push(cache.cache());
                value.cachedImages.preview[i] = cache.permalink;
              }
            }
          }

          Promise.all(imagePromises)
            .then(() => {
              r.table('bots')
                .insert(value, {
                  conflict: 'replace'
                })
                .then(() => {
                  discordWebhooks(`${req.user.username}#${req.user.discriminator} (${req.user.id}) ${type} <@${value.id}> - ${config.webserver.location}bots/${value.id}`);
                  res.json({
                    ok: true,
                    message: res.__(message),
                    redirect: `/bots/${value.id}`
                  });
                })
                .catch((err1) => {
                  next(err1);
                });
            })
            .catch((err1) => {
              res.json({
                ok: false,
                message: err1.message
              });
            });
        };

        r.table('bots')
          .get(value.id)
          .then((existingBot) => {
            if (existingBot) {
              if (existingBot.authors.includes(req.user.id) || req.user.admin) {
                // Copy over some stuff while overwriting
                value.verified = existingBot.verified;
                value.legacy = existingBot.legacy;
                value.random = existingBot.random;
                value.token = existingBot.token;
                value.created = existingBot.created || (new Date()).getTime();
                value.edited = (new Date()).getTime();
                value.hide = existingBot.hide;
                insert('edited', 'errors.bots.edit_success');
              } else {
                res.json({
                  ok: false,
                  message: res.__('errors.bots.exists')
                });
              }
            } else {
              value.verified = false;
              value.legacy = false;
              value.random = Math.random();
              value.token = crypto.randomBytes(20).toString('hex');
              value.created = (new Date()).getTime();
              value.edited = (new Date()).getTime();
              value.hide = false;
              fetch(`https://discordapp.com/api/v6/users/${value.id}`, {
                headers: {
                  Authorization: `Bot ${config.discord.token}`
                }
              })
                .then(result => result.json())
                .then((result) => {
                  if (result.code === 10013) {
                    res.json({
                      ok: false,
                      message: res.__('errors.bots.notfound')
                    });
                  } else if (result.bot) {
                    insert('added', 'errors.bots.add_success', result.avatar);
                  } else {
                    res.json({
                      ok: false,
                      message: res.__('errors.bots.notabot')
                    });
                  }
                });
            }
          })
          .catch((err1) => {
            next(err1);
          });
      }
    });
  }, (err, req, res, next) => {
    if (err) {
      res.status(500).json({
        ok: false,
        message: err.stack
      });
    } else {
      next();
    }
  });

module.exports = router;
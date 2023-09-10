const pluginName = 'nextcloud-plus'
module.exports = (ctx) => {
  const register = () => {
    ctx.helper.uploader.register(pluginName, {
      handle: uploader,
      name: 'Nextcloud',
      config: config
    })

    ctx.on('remove', onRemove)
  }

  const mimeTypes = {
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff'
  }

  const Base64 = require('js-base64').Base64

  // Basic auth
  const getAuth = function (user, password) {
    let loginUser = user + ':' + password
    return "Basic " + Base64.encode(loginUser)
  }

  const getUserConfig = function () {
    let userConfig = ctx.getConfig('picBed.' + pluginName)

    if (!userConfig) {
      throw new Error('请先配置nextcloud上传参数')
    }
    const host = userConfig.host
    const path = userConfig.path
    const user = userConfig.user
    const password = userConfig.password
    userConfig['baseUrl'] = `${host}/remote.php/dav/files/${user}/${encodeURI(path)}`
    userConfig['shareUrl'] = `${host}/ocs/v2.php/apps/files_sharing/api/v1/shares`
    userConfig['auth'] = getAuth(user, password)
    return userConfig
  }

  const getPubHeaders = function () {
    let userConfig = getUserConfig()
    return {
      'OCS-APIREQUEST': 'true',
      'User-Agent': 'PicGo',
      'Accept': 'application/json',
      'Authorization': userConfig['auth']
    }
  }

  const deleteFile = async function (fileName) {
    let userConfig = getUserConfig()
    let headers = getPubHeaders()
    try {
      await ctx.request({
        method: 'delete',
        url: `${userConfig['baseUrl']}/${encodeURI(fileName)}`,
        headers: headers
      })
    } catch(err) {
      ctx.emit('notification', {
        title: '删除失败',
        body: `${err.message}`
      })
    }
  }

  const onRemove = async function (files) {
    let userConfig = getUserConfig()
    if (!userConfig.syncDel){
      return
    }
    const rms = files.filter(each => each.type === pluginName)
    if (rms.length === 0) {
      return
    }
    const fail = []
    for (let i = 0; i < rms.length; i++) {
      const each = rms[i]
      let image = rms[i]
      deleteFile(image.fileName).catch((err) => {
        ctx.log.info(JSON.stringify(err))
        fail.push(each)
      })
    }

    if (fail.length) {
      const uploaded = ctx.getConfig('uploaded') || []
      uploaded.unshift(...fail)
      ctx.saveConfig(uploaded)
    }
  }

  const uploader = async function (ctx) {
    let userConfig = getUserConfig()

    try {
      let imgList = ctx.output
      for (let i in imgList) {
        let image = imgList[i]
        let data = image.buffer
        if (!data && image.base64Image) {
          data = Buffer.from(image.base64Image, 'base64')
        }
        let headers = getPubHeaders()
        const contentType = mimeTypes[image.extname] || 'application/octet-stream'
        await ctx.request({
          method: 'put',
          url: `${userConfig['baseUrl']}/${encodeURI(image.fileName)}`,
          headers: {
            ...headers,
            'Content-Disposition': `attachment; filename="${encodeURI(image.fileName)}"`,
            'Content-Type': contentType
          },
          body: data
        })

        let body = await ctx.request({
          method: 'post',
          url: userConfig['shareUrl'],
          headers: headers,
          formData: {
            path: `${userConfig.path}/${image.fileName}`,
            shareType: 3
          }
        })
        delete image.base64Image
        delete image.buffer
        body = JSON.parse(body).ocs
        if (body.meta.statuscode === 200) {
          image.imgUrl = body.data.url + '/preview'
          ctx.emit('notification', {
            title: '图片链接已复制！',
            body: ''
          })
        } else {
          ctx.emit('notification', {
            title: 'Nextcloud共享失败',
            body: '请检查Nextcloud设置'
          })
          deleteFile(image.fileName)
        }
      }
    } catch (err) {
      if (err.message.indexOf('404') === 0) {
        ctx.emit('notification', {
          title: '上传失败',
          body: '路径不存在，请检查路径设置'
        })
      } else {
        ctx.emit('notification', {
          title: '上传失败',
          body: err.message
        })
        ctx.log.error('', e)
      }
    }
  }
  const config = ctx => {
    let userConfig = ctx.getConfig('picBed.' + pluginName)
    if (!userConfig) {
      userConfig = {}
    }
    return [
      {
        name: 'host',
        type: 'input',
        default: userConfig.host,
        required: true,
        message: 'Nextcloud service address',
        alias: 'service'
      },
      {
        name: 'user',
        type: 'input',
        default: userConfig.user,
        required: true,
        message: 'username',
        alias: 'username'
      },
      {
        name: 'password',
        type: 'password',
        default: userConfig.password,
        required: true,
        message: 'password',
        alias: 'password'
      },
      {
        name: 'path',
        type: 'input',
        default: userConfig.path,
        required: true,
        message: 'path',
        alias: 'path'
      },
      {
        name: 'syncDel',
        type: 'confirm',
        default: userConfig.syncDel,
        required: true,
        message: 'sync delete',
        alias: 'sync del'
      }
    ]
  }
  return {
    uploader: pluginName,
    register
  }
}

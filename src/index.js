import request from 'request-promise'
import fs from 'fs'
import path from 'path'
import PromisePool from 'es6-promise-pool'

const BASE_URL = 'http://10.100.186.40:81'

const DEFAULT_INCLUDE = /\.js$|\.map$/
const DEFAULT_TRANSFORM = filename => `~/${filename}`
const DEFAULT_DELETE_REGEX = /\.map$/
const DEFAULT_UPLOAD_FILES_CONCURRENCY = Infinity

module.exports = class SentryPlugin {
  constructor(options) {
    this.baseSentryURL = options.baseSentryURL || BASE_URL
    this.include = options.include || DEFAULT_INCLUDE
    this.exclude = options.exclude

    this.filenameTransform = options.filenameTransform || DEFAULT_TRANSFORM
    this.deleteAfterCompile = options.deleteAfterCompile
    this.deleteRegex = options.deleteRegex || DEFAULT_DELETE_REGEX
    this.uploadFilesConcurrency =
      options.uploadFilesConcurrency || DEFAULT_UPLOAD_FILES_CONCURRENCY
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapPromise('SentryPlugin', async (compilation) => {
      const files = this.getFiles(compilation)

      try {
        await this.uploadFiles(files)
      }
      catch (error) {
        this.handleErrors(error, compilation)
      }
    })

    compiler.hooks.done.tapPromise('SentryPlugin', async (stats) => {
      if (this.deleteAfterCompile) {
        await this.deleteFiles(stats)
      }
    })
  }

  handleErrors(err, compilation) {
    const errorMsg = `Sentry Plugin: ${err}`
    if (
      err.statusCode === 409
    ) {
      compilation.warnings.push(errorMsg)
    }
    else {
      compilation.errors.push(errorMsg)
    }
  }

  // eslint-disable-next-line class-methods-use-this
  getAssetPath(compilation, name) {
    return path.join(
      compilation.getPath(compilation.compiler.outputPath),
      name.split('?')[0]
    )
  }

  getFiles(compilation) {
    return Object.keys(compilation.assets)
      .map((name) => {
        if (this.isIncludeOrExclude(name)) {
          return { name, filePath: this.getAssetPath(compilation, name) }
        }
        return null
      })
      .filter(i => i)
  }

  isIncludeOrExclude(filename) {
    const isIncluded = this.include ? this.include.test(filename) : true
    const isExcluded = this.exclude ? this.exclude.test(filename) : false

    return isIncluded && !isExcluded
  }

  // eslint-disable-next-line class-methods-use-this
  combineRequestOptions(req, requestOptionsFunc) {
    const combined = Object.assign({}, req)
    return combined
  }

  uploadFiles(files) {
    const pool = new PromisePool(() => {
      const file = files.pop()
      if (!file) {
        return null
      }

      return this.uploadFile(file)
    }, this.uploadFilesConcurrency)
    return pool.start()
  }

  async uploadFile({ filePath, name }) {
    await request(
      this.combineRequestOptions(
        {
          url: `${this.sentryReleaseUrl()}/`,
          method: 'POST',
          headers: {},
          formData: {
            file: fs.createReadStream(filePath),
            name: this.filenameTransform(name)
          }
        }
      )
    )
  }

  sentryReleaseUrl() {
    return this.baseSentryURL
  }

  async deleteFiles(stats) {
    Object.keys(stats.compilation.assets)
      .filter(name => this.deleteRegex.test(name))
      .forEach((name) => {
        const filePath = this.getAssetPath(stats.compilation, name)
        if (filePath) {
          fs.unlinkSync(filePath)
        }
        else {
          // eslint-disable-next-line no-console
          console.warn(
            `WebpackSentryPlugin: unable to delete '${name}'. ` +
            'File does not exist; it may not have been created ' +
            'due to a build error.'
          )
        }
      })
  }
}

import * as Zip from 'jszip'
import * as fs from 'fs'
import * as path from 'path'
import { Lambda } from './index'

export function getParent(path: string) {
  if (path === '/') {
    return path
  }

  const parts = split(path)
  const parent = '/' + parts
    .slice(0, -1)
    .join('/')

  return parent
}

export function split(path: string) {
  return path
    .split('/')
    .filter(part => !!part)
}

export function validateLamda(lambda: Lambda) {
  let handlerHasMatch = false
  const handlerFilename = lambda
    .handler
    .split('.')[0]

  for (const file of lambda.files) {
    try {
      // If the file does not exist, throw with a meaningful error
      const lambdaFile = typeof file === 'string'
        ? file
        : file.path

      fs.statSync(lambdaFile)
      const basename = path.basename(lambdaFile)
      const ext = path.extname(basename)
      const bareBasename = basename.replace(ext, '')

      const filename = typeof file === 'string'
        ? bareBasename
        : path.join(file.folder, bareBasename)

      const isHandler = handlerFilename === filename
      if (isHandler) {
        handlerHasMatch = true
      }

    } catch (ex) {
      throw new Error(`Cannot register Lambda '${lambda.functionName}': ${file} does not exist`)
    }
  }

  if (!handlerHasMatch) {
    throw new Error(`Cannot register Lambda '${lambda.functionName}: Handler '${lambda.handler}' not found in provided files list`)
  }
}

export async function zip(lambda: Lambda): Promise<Buffer> {
  const zip = new Zip()
  const files = lambda.files

  for (const file of files) {

    // If the file is just a string, put the file at the top-level
    if (typeof file === 'string') {
      const buffer = fs.readFileSync(file)
      zip.file(path.basename(file), buffer)
      continue
    }

    // Otherwise insert the file at the folder name provided
    const buffer = fs.readFileSync(file.path)
    zip.file(path.join(file.folder, path.basename(file.path)), buffer)
  }

  const buffer: Buffer = await zip.generateAsync({ type: 'nodebuffer' })
  return buffer
}
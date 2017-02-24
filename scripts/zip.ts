import * as fs from 'fs';
import * as Zip from 'adm-zip'
import * as path from 'path'

export default function getZipBuffer(): Buffer {
  const archive = new Zip()
  const files = fs.readdirSync(path.resolve(__dirname, '..', 'src'))
    .filter(file => path.extname(file) === '.js')
    .map(file => path.resolve(__dirname, '..', 'src', file))

  for (const file of files) {
    archive.addLocalFile(file)
  }

  const buffer = archive.toBuffer()
  return buffer
}
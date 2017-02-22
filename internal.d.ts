declare module 'tar-fs' {
  namespace api {
    function pack(folder: string): NodeJS.ReadableStream
  }
  export = api
}


declare module 'dotenv' {
  interface DotEnvOptions {
    path?: string
    encoding?: string
  }

  namespace DotEnv {
    function config(options?: DotEnvOptions): void
  }

  export = DotEnv
}
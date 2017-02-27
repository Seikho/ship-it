export default async function print(promise: Promise<any>, message?: string) {
  let result: any
  if (message) {
    console.log(`>>>>>>>>> ${message}`)
  }

  try {
    result = await promise
  } catch (ex) {
    console.log(ex)
    throw ex
  }

  try {
    console.log(JSON.stringify(result, null, 2))
    return result
  } catch (ex) {
    console.log(result)
    return result
  }
}

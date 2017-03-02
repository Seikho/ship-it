# Example

Requirements:
- `env-cmd` is installed globally
  - `npm install env-cmd -g`

This project is set up to deploy using:

```
npm run deploy
```

This runs `index.js` and deploys `quote.js` to AWS Lambda
The Lambda will call `get()` in `quote.js` when `GET /quote/13` is hit
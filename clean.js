var path = require('path')
var del = require('del')

del([
    path.resolve('src/**/*.js'),
    path.resolve('src/**/*.map'),
])
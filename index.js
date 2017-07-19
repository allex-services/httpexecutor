function createServicePack(execlib) {
  'use strict';
  return {
    service: {
      dependencies: ['allex_httpservice']
    },
    sinkmap: {
      dependencies: ['allex_httpservice']
    }, /*
    tasks: {
      dependencies: []
    }
    */
  }
}

module.exports = createServicePack;

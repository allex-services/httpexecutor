function createServicePack(execlib) {
  'use strict';
  return {
    service: {
      dependencies: ['allex:http']
    },
    sinkmap: {
      dependencies: ['allex:http']
    }, /*
    tasks: {
      dependencies: []
    }
    */
  }
}

module.exports = createServicePack;

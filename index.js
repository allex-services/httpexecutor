function createServicePack(execlib) {
  'use strict';
  return {
    service: {
      dependencies: ['allex_httpservice', 'allex:httprequestparameterextraction:lib']
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

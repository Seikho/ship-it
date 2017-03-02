#!/usr/bin/env groovy

node {
    try {
        step([$class: 'StashNotifier'])

        stage('Checkout') {
            checkout scm
        }

        stage('Bootstrap') {
            sh 'node -v'
            sh 'yarn'
        }

        stage('Build') {
            sh 'yarn run tsc'
        }

        stage('Deploy') {
            sh 'yarn run deploy'
        }

        currentBuild.result = 'SUCCESS'
    }
    catch (err) {
        currentBuild.result = "FAILURE"

        throw err
    } finally {
        step([$class: 'StashNotifier'])
    }
}

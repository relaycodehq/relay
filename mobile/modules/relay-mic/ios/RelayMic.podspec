Pod::Spec.new do |s|
  s.name           = 'RelayMic'
  s.version        = '1.0.0'
  s.summary        = 'Relay mic'
  s.author         = 'Relay'
  s.homepage       = 'https://github.com/relaycodehq/relay'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end

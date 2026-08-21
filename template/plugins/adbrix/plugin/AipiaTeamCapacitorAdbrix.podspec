require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'AipiaTeamCapacitorAdbrix'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://github.com/aipia-team/app-harness'
  s.author = 'AIPIA'
  s.source = { :git => 'https://github.com/aipia-team/app-harness.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  # Adbrix iOS SDK. 이 플러그인은 네이티브 SDK 를 직접 호출한다(Flutter 의존성 없음).
  # 버전 3.2.1 은 DFINERY 가 자사 공식 래퍼에서 검증해 배포 중인 조합이라 그대로 채택했다.
  s.dependency 'adbrix2.0', '3.2.1'
  s.swift_version = '5.1'
end

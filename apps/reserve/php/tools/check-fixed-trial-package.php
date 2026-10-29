<?php
declare(strict_types=1);
// Packaging check only: no bootstrap, config, database or network access.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
$root = dirname(__DIR__);
$expected = [
    'lib/LaneBookingSafety.php' => '6a2fb20667c79eb2a20b63c4e4450af50190a08c05755cd9acaea9941306ce17',
    'lib/LaneMutationSafety.php' => '84d57cbe480d418dd12bf8ab139a287084af8d0cdf33e37018dcfbb6fa6cd254',
    'lib/LaneMutationReadback.php' => '2c855b0814e2816cc2fed016ec485e413a31d1c8b8c7d118bb4697999f97c347',
    'lib/LaneMutationPolicy.php' => '9b262dd114121c9a110b962c80e0e47a18e31ebffb5c64761625058e4593bfc3',
    'lib/LanePatientSafety.php' => '2e7ac5a05cb4aea5c9dd1020373af3e7e334f5c719b718b6f2fea2ae16c1b9e2',
    'lib/LanePatientPolicy.php' => '951bce983477cd5a88c40c1a4935d5308bb3cba3250847a8e0cd6a42314f1208',
];
try {
    foreach ($expected as $name => $hash) {
        $path = $root . '/' . $name;
        if (!is_file($path) || is_link($path)
            || hash('sha256', str_replace("\r\n", "\n", file_get_contents($path))) !== $hash) {
            throw new RuntimeException('fixed_trial_package_changed: ' . $name);
        }
    }
    // Policies are required only after their reviewed source hashes match.
    foreach (['LaneMutationPolicy', 'LanePatientPolicy'] as $name) {
        $policy = require $root . '/lib/' . $name . '.php';
        if ($policy['enabled'] !== false || $policy['approval'] !== null
            || $policy['releaseRoot'] !== null || $policy['sourceHashes'] !== []) {
            throw new RuntimeException('fixed_trial_policy_not_disabled');
        }
    }
    $api = file_get_contents($root . '/api/index.php');
    foreach (["\$sub === 'safe-mutations'", "\$sub === 'safe-patients'", 'LaneMutationSafety::mutate', 'LanePatientSafety::create', 'LaneBookingSafety::read'] as $part) {
        if (!str_contains($api, $part)) throw new RuntimeException('fixed_trial_route_missing');
    }
    echo json_encode(['status' => 'verified', 'disabled' => true, 'files' => count($expected), 'databaseAccess' => false], JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n"); exit(1);
}

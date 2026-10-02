<?php

declare(strict_types=1);

namespace OCA\DrawioCollab\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Constants;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserSession;

class TokenController extends Controller
{
    public function __construct(
        string $appName,
        IRequest $request,
        private IConfig $config,
        private IUserSession $userSession,
        private IRootFolder $rootFolder,
    ) {
        parent::__construct($appName, $request);
    }

    #[NoAdminRequired]
    public function show(string $fileId): JSONResponse
    {
        $secret = (string) $this->config->getAppValue('drawio_collab', 'rt_secret', '');
        if ($secret === '') {
            return new JSONResponse(['error' => 'drawio_collab rt_secret is empty'], Http::STATUS_SERVICE_UNAVAILABLE);
        }

        $user = $this->userSession->getUser();
        if ($user === null) {
            return new JSONResponse(['error' => 'login required'], Http::STATUS_UNAUTHORIZED);
        }

        if ($fileId === '' || ! ctype_digit($fileId)) {
            return new JSONResponse(['error' => 'fileId required'], Http::STATUS_BAD_REQUEST);
        }

        $nodes = $this->rootFolder->getUserFolder($user->getUID())->getById((int) $fileId);
        $file = $nodes[0] ?? null;
        if (! $file instanceof File) {
            return new JSONResponse(['error' => 'file not found'], Http::STATUS_NOT_FOUND);
        }

        if (($file->getPermissions() & Constants::PERMISSION_READ) !== Constants::PERMISSION_READ) {
            return new JSONResponse(['error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }

        $display = trim((string) preg_replace('/\s+/', ' ', $user->getDisplayName()));
        $who = $display === '' ? 'Guest' : explode(' ', $display)[0];
        $room = 'd-'.$file->getId();
        $expiresAt = time() + (8 * 60 * 60);

        return new JSONResponse([
            'room' => $room,
            'rt' => self::mint($room, $user->getUID(), $expiresAt, $secret, $who),
            'who' => $who,
            'uid' => $user->getUID(),
        ]);
    }

    public static function mint(string $roomId, string $userId, int $expiresAt, string $secret, string $who = ''): string
    {
        if ($secret === '') {
            return '';
        }

        $payload = ['r' => $roomId, 'u' => $userId, 'e' => $expiresAt];
        if ($who !== '') {
            $payload['n'] = $who;
        }

        $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $body = rtrim(strtr(base64_encode($json), '+/', '-_'), '=');

        return $body.'.'.hash_hmac('sha256', $body, $secret);
    }
}

<?php

declare(strict_types=1);

namespace OCA\DrawioCollab\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\IRequest;
use OCP\Util;

class Application extends App implements IBootstrap
{
    public const APP_ID = 'drawio_collab';

    public function __construct()
    {
        parent::__construct(self::APP_ID);
    }

    public function register(IRegistrationContext $context): void
    {
    }

    public function boot(IBootContext $context): void
    {
        $context->injectFn(function (IRequest $request): void {
            $path = $request->getPathInfo() ?? '';
            if (! str_contains($path, '/apps/drawio')) {
                return;
            }

            // Init scripts run before the Draw.io editor script, so the
            // iframe src hook is in place before Nextcloud sets it.
            Util::addInitScript(self::APP_ID, 'inject');
        });
    }
}

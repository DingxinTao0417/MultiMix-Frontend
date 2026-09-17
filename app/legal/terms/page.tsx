import type { Metadata } from "next";
import { displayLegalField, LEGAL_EFFECTIVE_DATE, LEGAL_OPERATOR, LEGAL_VERSION } from "../legal-content";
import { LegalShell, legalStyles as styles } from "../legal-shell";

export const metadata: Metadata = {
  title: "服务条款｜MultiMix",
  description: "MultiMix 服务条款",
};

export default function TermsPage() {
  return (
    <LegalShell>
      <h1>MultiMix 服务条款</h1>
      <p className={styles.meta}>版本：{LEGAL_VERSION} · 生效日期：{LEGAL_EFFECTIVE_DATE}</p>
      <p className={styles.lead}>本条款适用于你访问和使用 MultiMix 对话式 AI 短视频创作工作台。注册前请完整阅读；勾选同意并提交注册，即表示你理解并接受本条款与同版本隐私政策。</p>

      <dl className={styles.details} aria-label="运营信息">
        <div><dt>运营主体</dt><dd>{displayLegalField(LEGAL_OPERATOR.name)}</dd></div>
        <div><dt>注册地址</dt><dd>{displayLegalField(LEGAL_OPERATOR.registeredAddress)}</dd></div>
        <div><dt>法律联系邮箱</dt><dd>{displayLegalField(LEGAL_OPERATOR.contactEmail)}</dd></div>
      </dl>

      <section>
        <h2>1. 服务内容与测试阶段</h2>
        <p>MultiMix 帮助用户通过对话组织创作需求、理解上传资料、生成或编辑文案、图片和视频，并保存相关项目与产物。公开版本可能仍处于测试阶段，功能范围、可用模型和处理时长会随产品演进调整。</p>
        <p>当前页面不构成收费、积分、自动续费、退款或发票承诺。任何未来付费能力都会在购买前另行展示价格、权益、有效期、退款与开票规则，并取得单独确认。</p>
      </section>

      <section>
        <h2>2. 账号与使用资格</h2>
        <ul>
          <li>你应提供可接收验证与安全通知的邮箱，并妥善保管密码和登录链接。</li>
          <li>你应具备签订本条款所需的民事行为能力；代表组织使用时，应拥有相应授权。</li>
          <li>发现账号被盗用或异常访问时，应尽快通过公开联系渠道通知运营方并修改密码。</li>
        </ul>
      </section>

      <section>
        <h2>3. 用户内容与授权</h2>
        <p>你保留对合法上传资料、输入内容和依法享有权利的产物所拥有的权利。为提供、维护和改进你请求的服务，你授予运营方在服务期间处理、转换、存储、展示和传输相关内容的必要许可。</p>
        <p>你应确保有权上传和使用其中的人像、声音、商标、音乐、字体、商业资料及其他受保护内容，并对发布前的事实、授权和平台规则负责。</p>
      </section>

      <section>
        <h2>4. AI 输出与人工复核</h2>
        <p>AI 输出可能不准确、不完整、与其他结果相似，或不符合特定行业和发布平台要求。你应在对外发布前核对事实、权利、合规性和适用性，尤其是广告承诺、价格、医疗、法律、金融及其他高风险信息。</p>
        <div className={styles.notice}><strong>与你有重大利害关系的提示：</strong>MultiMix 提供创作辅助，不保证任何输出必然准确、独占、可注册、可商用、能够通过第三方平台审核，或带来特定播放、转化与经营结果。</div>
      </section>

      <section>
        <h2>5. 禁止行为</h2>
        <ul>
          <li>上传、生成或传播违法、侵权、欺诈、骚扰、仇恨、露骨色情或危害他人安全的内容。</li>
          <li>未经授权处理他人的个人信息、肖像、声音、商业秘密或受版权保护的内容。</li>
          <li>绕过安全、配额、访问控制或费用确认机制，干扰服务，批量抓取，逆向破坏，或利用服务实施攻击。</li>
          <li>冒充他人、误导内容来源，或将 AI 生成内容用于法律禁止的用途。</li>
        </ul>
      </section>

      <section>
        <h2>6. 第三方服务与公共素材</h2>
        <p>为完成账号、存储、模型推理、渲染、托管和公共素材检索，服务可能连接第三方。第三方服务的可用性和许可规则由其提供方控制；使用公共素材时，你仍应核对来源、许可、署名与使用限制。</p>
      </section>

      <section>
        <h2>7. 服务变更、暂停与终止</h2>
        <p>运营方可以为安全、维护、法律要求或产品调整暂停部分能力，并在合理范围内提供提示。严重违反本条款、侵害他人权利或危及服务安全时，运营方可限制或终止账号，并在法律要求的范围内保留相关记录。</p>
      </section>

      <section>
        <h2>8. 责任边界</h2>
        <p>运营方会采取合理措施保障服务稳定和数据安全，但互联网、第三方服务及生成模型存在固有限制。法律不允许排除或限制的责任不受本条款影响；对于可依法限制的责任，具体范围以适用法律允许的范围为限。</p>
      </section>

      <section>
        <h2>9. 条款更新与联系</h2>
        <p>条款发生重大变化时，运营方会更新版本和生效日期，并按影响程度通过页面提示、账号通知或重新勾选等方式告知。继续使用前，你可以保存本页副本。</p>
        <p>运营信息见本页开头。相关字段更新时会同步更新版本或页面记录；正式商业化前仍应由经营或法律负责人复核适用的争议解决条款。</p>
      </section>
    </LegalShell>
  );
}

import type { Metadata } from "next";
import { displayLegalField, LEGAL_EFFECTIVE_DATE, LEGAL_OPERATOR, LEGAL_VERSION } from "../legal-content";
import { LegalShell, legalStyles as styles } from "../legal-shell";

export const metadata: Metadata = {
  title: "隐私政策｜MultiMix",
  description: "MultiMix 隐私政策",
};

export default function PrivacyPage() {
  return (
    <LegalShell>
      <h1>MultiMix 隐私政策</h1>
      <p className={styles.meta}>版本：{LEGAL_VERSION} · 生效日期：{LEGAL_EFFECTIVE_DATE}</p>
      <p className={styles.lead}>本政策说明 MultiMix 在提供账号、素材理解和 AI 创作服务时如何处理个人信息。我们按实现所需的最小范围处理信息，不以本政策替代需要单独取得的授权。</p>

      <dl className={styles.details} aria-label="个人信息处理者信息">
        <div><dt>个人信息处理者</dt><dd>{displayLegalField(LEGAL_OPERATOR.name)}</dd></div>
        <div><dt>注册地址</dt><dd>{displayLegalField(LEGAL_OPERATOR.registeredAddress)}</dd></div>
        <div><dt>隐私联系邮箱</dt><dd>{displayLegalField(LEGAL_OPERATOR.contactEmail)}</dd></div>
      </dl>

      <section>
        <h2>1. 我们处理的信息</h2>
        <ul>
          <li><strong>账号信息：</strong>邮箱、认证状态、账号标识、登录与密码恢复记录。</li>
          <li><strong>创作输入：</strong>对话需求、项目说明、上传的图片、视频、音频、文档及其文件信息。</li>
          <li><strong>创作过程与产物：</strong>需求理解、脚本、素材引用、生成参数、候选内容、编辑记录、反馈和导出结果。</li>
          <li><strong>运行与安全信息：</strong>访问时间、设备和浏览器基础信息、IP 地址、请求与任务状态、错误、安全及用量日志。</li>
        </ul>
        <p>请避免上传与创作目的无关的身份证件、金融账户、精确位置、健康、生物识别或其他敏感个人信息。确需处理时，应先取得相应授权并确认服务适合该用途。</p>
      </section>

      <section>
        <h2>2. 处理目的与方式</h2>
        <ul>
          <li>创建和保护账号，完成验证、登录、会话续期与密码恢复。</li>
          <li>保存项目和素材，理解用户要求，生成、渲染、编辑与交付用户请求的内容。</li>
          <li>展示任务状态、恢复中断工作、排查故障、保障安全、防止滥用并控制服务成本。</li>
          <li>依据经匿名化或去标识化的统计了解产品使用情况并改进质量。</li>
          <li>遵守适用法律、处理权利请求和争议。</li>
        </ul>
      </section>

      <section>
        <h2>3. 委托处理、共享与第三方服务</h2>
        <p>服务按实际配置可能使用 Supabase 提供账号、数据库和对象存储，Vercel 提供前端托管，Railway 提供后端与任务运行，并调用阿里云百炼、OpenAI 兼容模型服务或 Modal 完成理解、生成与渲染；公共素材检索可能连接 Pexels 或 Unsplash。</p>
        <p>我们仅向完成相应功能所需的服务商提供必要信息，并要求其按约定目的和安全措施处理。我们不会出售个人信息，也不会因广告定向向无关第三方提供用户上传内容。</p>
        <div className={styles.notice}><strong>跨境提示：</strong>部分托管、模型或素材服务可能在中国大陆以外处理数据。正式上线前，运营方必须按实际供应商、存储区域和调用路径完成跨境影响核对，并在法律要求时另行告知和取得单独同意；在核对完成前，不应主动上传敏感个人信息或受严格地域限制的数据。</div>
      </section>

      <section>
        <h2>4. 保存期限</h2>
        <p>账号和项目内容在提供服务、支持用户找回与履行法律义务所需期间保存。任务临时文件、缓存和日志按故障恢复、安全与成本核对所需的较短期限保存。账号删除、项目删除和备份清理的具体期限应在生产数据生命周期完成核对后补入正式版本。</p>
      </section>

      <section>
        <h2>5. 你的权利</h2>
        <p>在适用法律规定的范围内，你可以请求查阅、复制、更正、补充或删除个人信息，撤回基于同意的处理，注销账号，并要求解释处理规则。撤回同意不影响撤回前已经进行的合法处理；部分记录可能因安全、审计或法定义务继续保存。</p>
      </section>

      <section>
        <h2>6. 安全措施</h2>
        <p>我们采用访问控制、传输加密、受控密钥、权限隔离、任务幂等、日志与备份等合理措施保护信息。任何系统都不能保证绝对安全；发生或可能发生泄露、毁损或丢失时，我们会采取补救措施，并按法律要求通知用户和主管部门。</p>
      </section>

      <section>
        <h2>7. 未成年人</h2>
        <p>MultiMix 面向具有经营或专业创作需求的用户，不以不满十四周岁的未成年人为目标。若发现未取得监护人同意而处理了未成年人的个人信息，运营方会按核实结果采取限制或删除措施。</p>
      </section>

      <section>
        <h2>8. 更新与联系</h2>
        <p>重大变化会更新版本和生效日期，并按影响程度通过页面提示、账号通知或重新勾选等方式告知。权利请求可发送至本页开头列明的隐私联系邮箱；字段为空期间，相关联系信息将在确定后随页面版本补充。</p>
      </section>
    </LegalShell>
  );
}
